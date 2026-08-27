import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { db, getPreference, setPreference } from './db'
import { isStandaloneLaunch, newPairingAccessKey, pairingAccessKey, pairingInviteUrl } from './pairing'
import type { EventType, HouseholdMembership, PooConsistency, PuppyEvent } from './types'

const cloudUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const cloudKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
const membershipPreference = 'cloudMembership'
const accessKeyPreference = 'cloudAccessKey'

let client: SupabaseClient | undefined

export const cloudConfigured = Boolean(cloudUrl && cloudKey)

export function getCloudClient(): SupabaseClient | undefined {
  if (!cloudConfigured) return undefined
  client ??= createClient(cloudUrl!, cloudKey!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  })
  return client
}

export async function ensureCloudSession(): Promise<void> {
  const supabase = getCloudClient()
  if (!supabase) throw new Error('Cloud sync is not configured.')
  const { data } = await supabase.auth.getSession()
  if (data.session) return
  const { error } = await supabase.auth.signInAnonymously()
  if (error) throw error
}

export async function loadMembership(): Promise<HouseholdMembership | undefined> {
  const linkAccessKey = pairingAccessKey(window.location.search) ?? pairingAccessKey(window.location.hash)
  // Safari must retain the capability in the installation URL. With no fixed
  // manifest start_url, the first Home Screen launch inherits this exact URL.
  if (linkAccessKey && !isStandaloneLaunch()) return undefined
  if (linkAccessKey) {
    await setPreference(accessKeyPreference, linkAccessKey)
    window.history.replaceState(null, '', window.location.pathname)
  }
  const saved = await getPreference<HouseholdMembership | undefined>(membershipPreference, undefined)
  if (!cloudConfigured) return saved
  const accessKey = linkAccessKey ?? await getPreference<string | undefined>(accessKeyPreference, undefined)
  // Do not create anonymous cloud users for ordinary visitors. A saved
  // membership or possession of the private pairing link is required first.
  if (!saved && !accessKey) return undefined
  await ensureCloudSession()
  const supabase = getCloudClient()!
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id, display_name, households(name)')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    if (!accessKey) {
      await setPreference(membershipPreference, undefined)
      return undefined
    }
    const { data: joinedData, error: joinedError } = await supabase.rpc('bootstrap_household', {
      access_key_input: accessKey,
      display_name_input: 'Caregiver'
    }).single()
    if (joinedError) throw joinedError
    const joined = joinedData as { household_id: string; household_name: string }
    const membership: HouseholdMembership = {
      householdId: joined.household_id,
      householdName: joined.household_name,
      displayName: 'Caregiver'
    }
    await setPreference(membershipPreference, membership)
    return membership
  }
  const household = Array.isArray(data.households) ? data.households[0] : data.households
  const membership: HouseholdMembership = {
    householdId: data.household_id,
    householdName: household?.name ?? 'Our puppy',
    displayName: data.display_name
  }
  await setPreference(membershipPreference, membership)
  return membership
}

export async function createPhoneInvite(): Promise<{ membership: HouseholdMembership; url: string }> {
  const savedMembership = await getPreference<HouseholdMembership | undefined>(membershipPreference, undefined)
  let accessKey = await getPreference<string | undefined>(accessKeyPreference, undefined)
  if (!savedMembership) {
    accessKey = newPairingAccessKey()
    await setPreference(accessKeyPreference, accessKey)
  }
  if (!accessKey) throw new Error('This phone is missing its private household key.')
  const membership = await loadMembership()
  if (!membership) throw new Error('Could not create the private phone invitation.')
  return { membership, url: pairingInviteUrl(window.location.origin, window.location.pathname, accessKey) }
}

export type CloudEvent = {
  id: string
  household_id: string
  type: EventType | 'accident'
  occurred_at: string
  amount: number | null
  consistency: PooConsistency | null
  is_accident: boolean
  note: string | null
  tags: string[] | null
  updated_at: string
  deleted_at: string | null
}

export function toCloudEvent(event: PuppyEvent, householdId: string): CloudEvent {
  return {
    id: event.syncId,
    household_id: householdId,
    type: event.type,
    occurred_at: event.occurredAt,
    amount: event.amount ?? null,
    consistency: event.consistency ?? null,
    is_accident: event.isAccident ?? false,
    note: event.note ?? null,
    tags: event.tags ?? null,
    updated_at: event.updatedAt,
    deleted_at: event.deletedAt ?? null
  }
}

export function fromCloudEvent(remote: CloudEvent, localId?: number): PuppyEvent {
  const legacyAccident = remote.type === 'accident'
  const type = (legacyAccident ? 'pee' : remote.type) as EventType
  return {
    id: localId,
    syncId: remote.id,
    type,
    occurredAt: remote.occurred_at,
    amount: remote.amount ?? undefined,
    consistency: remote.consistency ?? undefined,
    isAccident: legacyAccident || remote.is_accident,
    note: remote.note ?? undefined,
    tags: remote.tags ?? undefined,
    updatedAt: remote.updated_at,
    deletedAt: remote.deleted_at ?? undefined,
    syncState: 'synced'
  }
}

export function shouldKeepPendingLocalEvent(local: PuppyEvent | undefined, remote: Pick<CloudEvent, 'updated_at'>): boolean {
  return local?.syncState === 'pending' && local.updatedAt > remote.updated_at
}

export async function syncEvents(membership: HouseholdMembership): Promise<PuppyEvent[]> {
  const supabase = getCloudClient()
  if (!supabase) return db.events.orderBy('occurredAt').reverse().filter((event) => !event.deletedAt).toArray()

  const pending = await db.events.where('syncState').equals('pending').toArray()
  if (pending.length) {
    const { error } = await supabase.from('puppy_events').upsert(
      pending.map((event) => toCloudEvent(event, membership.householdId)),
      { onConflict: 'id' }
    )
    if (error) throw error
    await db.events.bulkPut(pending.map((event) => ({ ...event, syncState: 'synced' as const })))
  }

  const { data, error } = await supabase
    .from('puppy_events')
    .select('id, household_id, type, occurred_at, amount, consistency, is_accident, note, tags, updated_at, deleted_at')
    .eq('household_id', membership.householdId)
  if (error) throw error

  await db.transaction('rw', db.events, async () => {
    for (const remote of data as CloudEvent[]) {
      const local = await db.events.where('syncId').equals(remote.id).first()
      if (shouldKeepPendingLocalEvent(local, remote)) continue
      await db.events.put(fromCloudEvent(remote, local?.id))
    }
  })

  return db.events.orderBy('occurredAt').reverse().filter((event) => !event.deletedAt).toArray()
}

export function subscribeToHousehold(membership: HouseholdMembership, onChange: () => void): RealtimeChannel | undefined {
  const supabase = getCloudClient()
  if (!supabase) return undefined
  return supabase
    .channel(`household-${membership.householdId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'puppy_events', filter: `household_id=eq.${membership.householdId}`
    }, onChange)
    .subscribe()
}

export async function unsubscribeFromHousehold(channel: RealtimeChannel | undefined): Promise<void> {
  if (channel && getCloudClient()) await getCloudClient()!.removeChannel(channel)
}
