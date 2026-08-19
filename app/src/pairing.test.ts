import { describe, expect, it } from 'vitest'
import { pairingAccessKey, shouldConsumePairingLink } from './pairing'

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
})
