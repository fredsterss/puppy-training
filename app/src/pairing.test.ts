import { describe, expect, it } from 'vitest'
import { newPairingAccessKey, pairingAccessKey, pairingInviteUrl, shouldConsumePairingLink } from './pairing'

describe('pairing install handoff', () => {
  it('preserves the private link while Safari adds the app to the Home Screen', () => {
    expect(shouldConsumePairingLink('#sync=household-secret', false)).toBe(false)
  })

  it('consumes the private link when the installed app launches', () => {
    expect(shouldConsumePairingLink('#sync=household-secret', true)).toBe(true)
    expect(pairingAccessKey('#sync=%20household-secret%20')).toBe('household-secret')
  })

  it('ignores ordinary launches', () => {
    expect(pairingAccessKey('')).toBeUndefined()
    expect(shouldConsumePairingLink('', true)).toBe(false)
  })

  it('creates a high-entropy private invitation for another phone', () => {
    const uuids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
    const accessKey = newPairingAccessKey(() => uuids.shift()!)
    expect(accessKey).toHaveLength(64)
    expect(pairingInviteUrl('https://example.com', '/puppy-training/', accessKey))
      .toBe(`https://example.com/puppy-training/#sync=${accessKey}`)
  })
})
