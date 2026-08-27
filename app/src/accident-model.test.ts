import { describe, expect, it } from 'vitest'
import { fromCloudEvent, shouldKeepPendingLocalEvent, toCloudEvent, type CloudEvent } from './cloud'
import { normalizeLegacyLocalEvent, type LegacyPuppyEvent } from './db'
import { buildPottyDetailChanges } from './domain'
import type { PuppyEvent } from './types'

const occurredAt = '2026-08-26T12:00:00.000Z'
const migratedAt = '2026-08-27T10:00:00.000Z'

function cloudEvent(overrides: Partial<CloudEvent> = {}): CloudEvent {
  return {
    id: 'event-1',
    household_id: 'household-1',
    type: 'pee',
    occurred_at: occurredAt,
    amount: null,
    consistency: null,
    is_accident: false,
    note: null,
    tags: null,
    updated_at: occurredAt,
    deleted_at: null,
    ...overrides
  }
}

describe('legacy local accident migration', () => {
  it('turns a standalone accident into a pending pee accident without losing its history', () => {
    const legacy: LegacyPuppyEvent = {
      id: 7,
      syncId: 'legacy-1',
      type: 'accident',
      occurredAt,
      tags: ['rug', 'after nap'],
      updatedAt: occurredAt,
      syncState: 'synced'
    }

    expect(normalizeLegacyLocalEvent(legacy, migratedAt)).toEqual({
      ...legacy,
      type: 'pee',
      isAccident: true,
      updatedAt: migratedAt,
      syncState: 'pending'
    })
  })

  it('leaves an existing potty event unchanged', () => {
    const pee: LegacyPuppyEvent = {
      syncId: 'pee-1', type: 'pee', occurredAt, updatedAt: occurredAt, syncState: 'synced'
    }
    expect(normalizeLegacyLocalEvent(pee, migratedAt)).toBe(pee)
  })
})

describe('cloud accident representation', () => {
  it.each([
    [true, true],
    [undefined, false]
  ] as const)('maps local isAccident=%s to is_accident=%s', (isAccident, expected) => {
    const event: PuppyEvent = {
      syncId: 'event-1', type: 'pee', occurredAt, isAccident, updatedAt: occurredAt, syncState: 'pending'
    }
    expect(toCloudEvent(event, 'household-1').is_accident).toBe(expected)
  })

  it('maps a canonical cloud poo accident without losing its details', () => {
    expect(fromCloudEvent(cloudEvent({
      type: 'poo', consistency: 'soft', is_accident: true, tags: ['garden']
    }), 12)).toMatchObject({
      id: 12, type: 'poo', consistency: 'soft', isAccident: true, tags: ['garden'], syncState: 'synced'
    })
  })

  it('normalizes a cloud event written by an old cached client', () => {
    expect(fromCloudEvent(cloudEvent({ type: 'accident', tags: ['rug'] }))).toMatchObject({
      type: 'pee', isAccident: true, occurredAt, tags: ['rug'], syncState: 'synced'
    })
  })

  it('keeps a newer pending local edit instead of replacing it with stale cloud data', () => {
    const local: PuppyEvent = {
      syncId: 'event-1', type: 'pee', occurredAt, updatedAt: migratedAt, syncState: 'pending'
    }
    expect(shouldKeepPendingLocalEvent(local, cloudEvent({ updated_at: occurredAt }))).toBe(true)
  })

  it('allows a newer cloud event to replace local data', () => {
    const local: PuppyEvent = {
      syncId: 'event-1', type: 'pee', occurredAt, updatedAt: occurredAt, syncState: 'pending'
    }
    expect(shouldKeepPendingLocalEvent(local, cloudEvent({ updated_at: migratedAt }))).toBe(false)
  })
})

describe('potty detail changes', () => {
  it('saves Poo consistency, accident state, and normalized tags', () => {
    expect(buildPottyDetailChanges({ type: 'poo' }, true, ' rug, #upstairs, Rug ', 'soft', migratedAt)).toEqual({
      isAccident: true,
      consistency: 'soft',
      tags: ['rug', 'upstairs'],
      updatedAt: migratedAt,
      syncState: 'pending'
    })
  })

  it('does not attach consistency to a Pee accident', () => {
    expect(buildPottyDetailChanges({ type: 'pee' }, true, 'rug', 'soft', migratedAt)).toMatchObject({
      isAccident: true, consistency: undefined, tags: ['rug']
    })
  })

  it('clears accident tags when the accident flag is turned off', () => {
    expect(buildPottyDetailChanges({ type: 'poo' }, false, 'rug, upstairs', 'normal', migratedAt)).toMatchObject({
      isAccident: false, consistency: 'normal', tags: []
    })
  })
})
