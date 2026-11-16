import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'

/**
 * This computer as an Overlay Computer. The embedded host serves Overlay's own
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
  if (system.platform !== 'darwin') throw new Error('This permission is available on macOS only.')
  if (permission === 'accessibility') {
    if (system.isTrustedAccessibilityClient(true)) return
  } else {
    if (system.getMediaAccessStatus('screen') === 'granted') return
    await system.probeScreenCapture().catch(() => undefined)
  }
  await system.openExternal(PRIVACY_PANES[permission])
}

/** "Keep this computer available": restart the local-tools host when Overlay opens. Stored per device. */
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

/**
 * The computer's own name, as its owner set it ("Sam's MacBook Pro"), which reads better than a network host name.
 */
export function localComputerName(
  platform: NodeJS.Platform = process.platform,
  read: () => string = () => execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2_000 })
): string {
  if (platform === 'darwin') {
    try {
      const name = read().trim()
      if (name) return name.slice(0, 80)
    } catch {
      // Fall through to the host name.
    }
  }
  return hostname().replace(/\.local$/, '').slice(0, 80) || 'This computer'
}

/**
 * Where a thread without a folder works, and where Overlay Files folders are copied. It is the first folder
 * approved for this computer, so the host always has somewhere to run.
 */
export function ensureLocalComputerWorkFolder(home: string = homedir()): string {
  const path = join(home, 'Overlay Files')
  mkdirSync(path, { recursive: true })
  return path
}

export function localComputerWorkFolder(home: string = homedir()): string {
  return join(home, 'Overlay Files')
}

/** The environment this computer connected as, read from the host's saved connection. */
export function localComputerEnvironmentId(hostStateDirectory: string): string | null {
  try {
    const config = JSON.parse(readFileSync(join(hostStateDirectory, 'config.json'), 'utf8')) as { environmentId?: unknown }
    return typeof config.environmentId === 'string' && config.environmentId ? config.environmentId : null
  } catch {
    return null
  }
}
