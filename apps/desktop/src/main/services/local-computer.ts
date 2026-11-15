import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * "This Mac" as an Overlay Computer. The embedded host serves Overlay's own
 * tools here (no third-party harness). macOS attributes the host's screen and
 * input access to this app, so the permissions are this app's permissions.
 */
export type LocalComputerPermission = 'accessibility' | 'screen_recording'

export interface LocalComputerSystem {
  platform: NodeJS.Platform
  isTrustedAccessibilityClient(prompt: boolean): boolean
  getMediaAccessStatus(media: 'screen'): string
  openExternal(url: string): Promise<void>
  /** Asking for a screen source registers the app in the Screen Recording list. */
  probeScreenCapture(): Promise<void>
}

const PRIVACY_PANES: Record<LocalComputerPermission, string> = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screen_recording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
}

export function localComputerPermissions(system: LocalComputerSystem): { accessibility: boolean; screenRecording: boolean } {
  if (system.platform !== 'darwin') return { accessibility: false, screenRecording: false }
  return {
    accessibility: system.isTrustedAccessibilityClient(false),
    screenRecording: system.getMediaAccessStatus('screen') === 'granted'
  }
}

/** Shows the macOS prompt where one exists and opens the matching privacy pane. */
export async function requestLocalComputerPermission(
  system: LocalComputerSystem,
  permission: LocalComputerPermission
): Promise<void> {
  if (system.platform !== 'darwin') throw new Error('This Mac permission is available on macOS only.')
  if (permission === 'accessibility') {
    if (system.isTrustedAccessibilityClient(true)) return
  } else {
    if (system.getMediaAccessStatus('screen') === 'granted') return
    await system.probeScreenCapture().catch(() => undefined)
  }
  await system.openExternal(PRIVACY_PANES[permission])
}

/** "Keep this Mac available": restart the local-tools host when Overlay opens. Stored per device. */
export class LocalComputerPreference {
  constructor(private readonly path: string) {}

  static in(userData: string): LocalComputerPreference {
    return new LocalComputerPreference(join(userData, 'local-computer.json'))
  }

  get keepAvailable(): boolean {
    try {
      return existsSync(this.path) && (JSON.parse(readFileSync(this.path, 'utf8')) as { keepAvailable?: unknown }).keepAvailable === true
    } catch {
      return false
    }
  }

  set keepAvailable(value: boolean) {
    writeFileSync(this.path, `${JSON.stringify({ keepAvailable: value })}\n`, { mode: 0o600 })
  }
}

export function localComputerHome(): string {
  return homedir()
}
