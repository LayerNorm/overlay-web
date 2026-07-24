import { mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userData: `/tmp/overlay-server-profile-test-${process.pid}`
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => mocks.userData,
    getVersion: () => '1.2.3',
    isPackaged: true
  }
}))

import {
  normalizeServerOrigin,
  serverProfileService
} from './server-profile-service'

const discovery = {
  api: { currentVersion: 'v1', supportedVersions: ['v1'] },
  deployment: { id: 'self-hosted-fixture' },
  minimumDesktopVersion: '1.0.0',
  nativeAuth: { flow: 'system_browser_pkce', supported: true }
}

describe('server profile trust boundary', () => {
  beforeAll(() => {
    rmSync(mocks.userData, { recursive: true, force: true })
    mkdirSync(mocks.userData, { recursive: true, mode: 0o700 })
  })

  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(() => {
    rmSync(mocks.userData, { recursive: true, force: true })
  })

  it('accepts HTTPS origins only and rejects credentials, paths, queries, and fragments', () => {
    expect(normalizeServerOrigin('https://overlay.example/')).toBe(
      'https://overlay.example'
    )
    for (const input of [
      'http://overlay.example',
      'https://user:pass@overlay.example',
      'https://overlay.example/api',
      'https://overlay.example?token=secret',
      'https://overlay.example/#fragment',
      'file:///etc/passwd'
    ]) {
      expect(() => normalizeServerOrigin(input)).toThrow()
    }
  })

  it('activates only a recent compatible discovery result with owner-only permissions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(discovery)))
    const candidate = await serverProfileService.verifyCandidate(
      'https://self-hosted.example'
    )
    expect(candidate).toMatchObject({
      deploymentId: 'self-hosted-fixture',
      mode: 'self-hosted',
      origin: 'https://self-hosted.example'
    })
    serverProfileService.activate(candidate)
    expect(serverProfileService.getActiveProfile()).toEqual(candidate)
    expect(
      statSync(path.join(mocks.userData, 'overlay-server-profile.json')).mode & 0o777
    ).toBe(0o600)

    expect(() =>
      serverProfileService.activate({
        ...candidate,
        verifiedAt: Date.now() - 11 * 60_000
      })
    ).toThrow('server_profile_not_recently_verified')
  })

  it('rejects incompatible discovery and minimum-version lockout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ...discovery,
          nativeAuth: { flow: 'legacy', supported: true }
        })
      )
    )
    await expect(
      serverProfileService.verifyCandidate('https://self-hosted.example')
    ).rejects.toThrow('server_discovery_incompatible')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ ...discovery, minimumDesktopVersion: '2.0.0' })
      )
    )
    await expect(
      serverProfileService.verifyCandidate('https://self-hosted.example')
    ).rejects.toThrow('server_requires_desktop:2.0.0')
  })
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}
