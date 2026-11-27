import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LocalComputerPreference,
  ensureLocalComputerWorkFolder,
  localComputerEnvironmentId,
  localComputerName,
  localComputerPermissions,
  requestLocalComputerPermission,
  type LocalComputerSystem
} from './local-computer'

function system(overrides: Partial<LocalComputerSystem> = {}): LocalComputerSystem {
  return {
    platform: 'darwin',
    isTrustedAccessibilityClient: vi.fn(() => false),
    getMediaAccessStatus: vi.fn(() => 'denied'),
    openExternal: vi.fn(async () => {}),
    probeScreenCapture: vi.fn(async () => {}),
    ...overrides
  }
}

describe('this Mac as a Computer', () => {
  it('reports the app permissions macOS grants for screen and input control', () => {
    expect(localComputerPermissions(system({ isTrustedAccessibilityClient: () => true, getMediaAccessStatus: () => 'granted' })))
      .toEqual({ accessibility: true, screenRecording: true })
    expect(localComputerPermissions(system({ platform: 'linux' }))).toEqual({ accessibility: false, screenRecording: false })
  })

  it('asks for accessibility with the macOS prompt, then opens the privacy pane', async () => {
    const mac = system()
    await requestLocalComputerPermission(mac, 'accessibility')
    expect(mac.isTrustedAccessibilityClient).toHaveBeenCalledWith(true)
    expect(mac.openExternal).toHaveBeenCalledWith(expect.stringContaining('Privacy_Accessibility'))
  })

  it('registers for screen recording and opens its pane, but does nothing once granted', async () => {
    const mac = system()
    await requestLocalComputerPermission(mac, 'screen_recording')
    expect(mac.probeScreenCapture).toHaveBeenCalled()
    expect(mac.openExternal).toHaveBeenCalledWith(expect.stringContaining('Privacy_ScreenCapture'))
    const granted = system({ getMediaAccessStatus: vi.fn(() => 'granted') })
    await requestLocalComputerPermission(granted, 'screen_recording')
    expect(granted.openExternal).not.toHaveBeenCalled()
  })

  it('remembers "keep this Mac available" per device', () => {
    const preference = LocalComputerPreference.in(mkdtempSync(join(tmpdir(), 'overlay-local-computer-')))
    expect(preference.keepAvailable).toBe(false)
    preference.keepAvailable = true
    expect(preference.keepAvailable).toBe(true)
    preference.keepAvailable = false
    expect(preference.keepAvailable).toBe(false)
  })
})

describe('this computer\'s identity', () => {
  it('uses the name the owner gave the computer, and falls back to the host name', () => {
    expect(localComputerName('darwin', () => 'Sam’s MacBook Pro\n')).toBe('Sam’s MacBook Pro')
    expect(localComputerName('darwin', () => { throw new Error('no scutil') })).not.toBe('')
    expect(localComputerName('linux', () => 'ignored')).not.toBe('ignored')
  })

  it('creates the work folder in the home folder', () => {
    const home = mkdtempSync(join(tmpdir(), 'overlay-home-'))
    const folder = ensureLocalComputerWorkFolder(home)
    expect(folder).toBe(join(home, 'Overlay Files'))
    expect(existsSync(folder)).toBe(true)
  })

  it('reads the connected environment from the host\'s saved connection', () => {
    const state = mkdtempSync(join(tmpdir(), 'overlay-host-'))
    expect(localComputerEnvironmentId(state)).toBeNull()
    mkdirSync(state, { recursive: true })
    writeFileSync(join(state, 'config.json'), JSON.stringify({ environmentId: 'env_123', localTools: true }))
    expect(localComputerEnvironmentId(state)).toBe('env_123')
    writeFileSync(join(state, 'config.json'), 'not json')
    expect(localComputerEnvironmentId(state)).toBeNull()
  })
})
