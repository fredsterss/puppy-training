import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
const accessKey = process.env.PUPPY_SYNC_SECRET

assert(url, 'SUPABASE_URL is required')
assert(publishableKey, 'SUPABASE_PUBLISHABLE_KEY is required')
assert(accessKey && accessKey.length >= 32, 'PUPPY_SYNC_SECRET must contain at least 32 characters')

function device() {
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
}

async function signIn(client) {
  const { data, error } = await client.auth.signInAnonymously()
  if (error) throw error
  assert(data.user?.is_anonymous, 'Expected an anonymous device identity')
}

async function join(client) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const { data, error } = await client.rpc('bootstrap_household', {
      access_key_input: accessKey,
      display_name_input: 'Smoke test device'
    }).single()
    if (!error) return data
    if (error.code !== 'PGRST303' || attempt === 5) throw error
    // Auth and Data API nodes can briefly disagree on the current second.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
}

const first = device()
const second = device()
const outsider = device()
await Promise.all([signIn(first), signIn(second), signIn(outsider)])
// Allow for small clock differences between the Auth and Data API services.
await new Promise((resolve) => setTimeout(resolve, 2_000))

const [firstMembership, secondMembership] = await Promise.all([join(first), join(second)])
assert.equal(firstMembership.household_id, secondMembership.household_id, 'Pairing did not resolve to one household')
const householdId = firstMembership.household_id

let resolveRealtime
let rejectRealtime
const realtimeEvent = new Promise((resolve, reject) => {
  resolveRealtime = resolve
  rejectRealtime = reject
})
const subscribed = new Promise((resolve, reject) => {
  const channel = second
    .channel(`smoke-${randomUUID()}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'puppy_events',
      filter: `household_id=eq.${householdId}`
    }, resolveRealtime)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve(channel)
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`Realtime subscription failed: ${status}`))
    })
})
const channel = await Promise.race([
  subscribed,
  new Promise((_, reject) => setTimeout(() => reject(new Error('Realtime subscription timed out')), 10_000))
])

const eventId = randomUUID()
const occurredAt = new Date().toISOString()
const { error: insertError } = await first.from('puppy_events').insert({
  id: eventId,
  household_id: householdId,
  type: 'poo',
  consistency: 'normal',
  is_accident: true,
  occurred_at: occurredAt,
  updated_at: occurredAt
})
if (insertError) throw insertError

await Promise.race([
  realtimeEvent,
  new Promise((_, reject) => setTimeout(() => reject(new Error('Realtime event was not delivered')), 10_000))
])

const { data: sharedRows, error: sharedReadError } = await second
  .from('puppy_events')
  .select('id, household_id, type, consistency, is_accident')
  .eq('id', eventId)
if (sharedReadError) throw sharedReadError
assert.equal(sharedRows.length, 1, 'Paired device could not read the event')
assert.equal(sharedRows[0].consistency, 'normal', 'Paired device could not read poo consistency')
assert.equal(sharedRows[0].is_accident, true, 'Paired device could not read the accident property')

const { data: outsiderRows, error: outsiderReadError } = await outsider
  .from('puppy_events')
  .select('id')
  .eq('id', eventId)
if (outsiderReadError) throw outsiderReadError
assert.equal(outsiderRows.length, 0, 'RLS exposed the event to an unpaired device')

const { error: outsiderWriteError } = await outsider.from('puppy_events').insert({
  id: randomUUID(),
  household_id: householdId,
  type: 'poo',
  occurred_at: occurredAt,
  updated_at: occurredAt
})
assert(outsiderWriteError, 'RLS allowed an unpaired device to write an event')

const deletedAt = new Date().toISOString()
const { error: cleanupError } = await first
  .from('puppy_events')
  .update({ deleted_at: deletedAt, updated_at: deletedAt })
  .eq('id', eventId)
if (cleanupError) throw cleanupError

await second.removeChannel(channel)
await Promise.all([first.removeAllChannels(), second.removeAllChannels(), outsider.removeAllChannels()])
await Promise.all([first.auth.signOut(), second.auth.signOut(), outsider.auth.signOut()])
console.log(JSON.stringify({
  anonymousAuth: true,
  pairedHousehold: true,
  sharedRead: true,
  realtimeDelivery: true,
  outsiderReadBlocked: true,
  outsiderWriteBlocked: true,
  tombstoneCleanup: true
}))
