import { app } from 'electron'
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OverlayServerDiscovery } from '@overlay/api-client'
import { readBoundedJson } from './bounded-json-response'

const PROFILE_FILE = 'overlay-server-profile.json'
const DESKTOP_VERSION = app.getVersion()

export type OverlayServerProfile = {
  deploymentId: string
  mode: 'cloud' | 'self-hosted'
  origin: string
  verifiedAt: number
}

class ServerProfileService {
  private profile: OverlayServerProfile | null = null

  getActiveProfile(): OverlayServerProfile {
    if (!this.profile) this.profile = this.loadProfile() ?? this.defaultProfile()
    return { ...this.profile }
  }

  getActiveOrigin(): string {
    return this.getActiveProfile().origin
  }

  async verifyCandidate(input: string): Promise<OverlayServerProfile> {
    const origin = normalizeServerOrigin(input)
    const response = await fetch(`${origin}/api/v1/discovery`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw new Error(`server_discovery_failed:${response.status}`)
    const discovery = (await readBoundedJson(response)) as Partial<OverlayServerDiscovery>
    if (
      discovery.api?.currentVersion !== 'v1' ||
      !discovery.api.supportedVersions?.includes('v1') ||
      discovery.nativeAuth?.supported !== true ||
      discovery.nativeAuth.flow !== 'system_browser_pkce' ||
      typeof discovery.deployment?.id !== 'string' ||
      !discovery.deployment.id.trim()
    ) {
      throw new Error('server_discovery_incompatible')
    }
    if (
      typeof discovery.minimumDesktopVersion === 'string' &&
      compareVersions(DESKTOP_VERSION, discovery.minimumDesktopVersion) < 0
    ) {
      throw new Error(`server_requires_desktop:${discovery.minimumDesktopVersion}`)
    }
    return {
      deploymentId: discovery.deployment.id.trim(),
      mode: isOverlayCloudOrigin(origin) ? 'cloud' : 'self-hosted',
      origin,
      verifiedAt: Date.now()
    }
  }

  activate(profile: OverlayServerProfile): void {
    const normalized = normalizeServerOrigin(profile.origin)
    if (
      !profile.deploymentId ||
      !Number.isFinite(profile.verifiedAt) ||
      Date.now() - profile.verifiedAt > 10 * 60_000
    ) {
      throw new Error('server_profile_not_recently_verified')
    }
    const next: OverlayServerProfile = {
      ...profile,
      origin: normalized,
      mode: isOverlayCloudOrigin(normalized) ? 'cloud' : 'self-hosted'
    }
    const path = this.getProfilePath()
    const temporaryPath = `${path}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(next, null, 2), {
      flag: 'w',
      mode: 0o600
    })
    chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, path)
    this.profile = next
  }

  private loadProfile(): OverlayServerProfile | null {
    const path = this.getProfilePath()
    if (!existsSync(path)) return null
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<OverlayServerProfile>
      if (
        typeof parsed.deploymentId !== 'string' ||
        typeof parsed.origin !== 'string' ||
        typeof parsed.verifiedAt !== 'number'
      ) {
        return null
      }
      chmodSync(path, 0o600)
      const origin = normalizeServerOrigin(parsed.origin)
      return {
        deploymentId: parsed.deploymentId,
        mode: isOverlayCloudOrigin(origin) ? 'cloud' : 'self-hosted',
        origin,
        verifiedAt: parsed.verifiedAt
      }
    } catch {
      return null
    }
  }

  private defaultProfile(): OverlayServerProfile {
    const origin = normalizeServerOrigin(
      process.env.APP_SERVER_URL?.trim() ||
        (app.isPackaged ? 'https://www.getoverlay.io' : 'http://localhost:3000')
    )
    return {
      deploymentId: origin,
      mode: isOverlayCloudOrigin(origin) ? 'cloud' : 'self-hosted',
      origin,
      verifiedAt: 0
    }
  }

  private getProfilePath(): string {
    return join(app.getPath('userData'), PROFILE_FILE)
  }
}

export function normalizeServerOrigin(input: string): string {
  if (typeof input !== 'string' || input.length > 2048) {
    throw new Error('invalid_server_origin')
  }
  const url = new URL(input.trim())
  const localDevelopment =
    !app.isPackaged &&
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (url.protocol !== 'https:' && !localDevelopment)
    throw new Error('server_origin_requires_https')
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('server_origin_must_be_origin_only')
  }
  return url.origin
}

function isOverlayCloudOrigin(origin: string): boolean {
  return origin === 'https://www.getoverlay.io' || origin === 'https://getoverlay.io'
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    value
      .replace(/^v/, '')
      .split(/[.-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0)
  }
  return 0
}

export const serverProfileService = new ServerProfileService()
