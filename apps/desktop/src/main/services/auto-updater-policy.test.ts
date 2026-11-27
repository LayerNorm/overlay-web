import { describe, expect, it } from 'vitest'
import { isAllowedStableUpgrade } from './auto-updater-policy'

describe('desktop updater version policy', () => {
  it('allows only strictly newer stable semantic versions', () => {
    expect(isAllowedStableUpgrade('1.2.3', '1.2.4')).toBe(true)
    expect(isAllowedStableUpgrade('1.2.3', '2.0.0')).toBe(true)
    expect(isAllowedStableUpgrade('v1.2.3', 'v1.3.0')).toBe(true)
  })

  it('rejects replays, downgrades, prereleases, builds, and malformed values', () => {
    expect(isAllowedStableUpgrade('1.2.3', '1.2.3')).toBe(false)
    expect(isAllowedStableUpgrade('1.2.3', '1.2.2')).toBe(false)
    expect(isAllowedStableUpgrade('1.2.3', '2.0.0-beta.1')).toBe(false)
    expect(isAllowedStableUpgrade('1.2.3', '2.0.0+build')).toBe(false)
    expect(isAllowedStableUpgrade('1.2', '2.0.0')).toBe(false)
  })
})
