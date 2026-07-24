import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
  encryptionAvailable: true,
  storeAuthSession: vi.fn(),
  getAuthSession: vi.fn(),
  getAuthSessionMetadata: vi.fn()
}))

vi.mock('electron', () => ({
  app: { isPackaged: true },
  shell: { openExternal: mocks.openExternal }
}))

vi.mock('./server-profile-service', () => ({
  serverProfileService: {
    getActiveOrigin: () => 'https://www.getoverlay.io'
  }
}))

vi.mock('./safe-storage-service', () => ({
  safeStorageService: {
    isEncryptionAvailable: () => mocks.encryptionAvailable,
    storeAuthSession: mocks.storeAuthSession,
    getAuthSession: mocks.getAuthSession,
    getAuthSessionMetadata: mocks.getAuthSessionMetadata
  }
}))

import {
  cancelPendingNativeAuth,
  consumeSessionTransferVerifier,
  startNativeSignIn
} from './native-auth-service'

const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: { id: 'user_12345', email: 'user@example.com' }
}

const discovery = {
  api: { currentVersion: 'v1', supportedVersions: ['v1'] },
  capabilities: { byok: true, hostedInference: true },
  deployment: { id: 'overlay-cloud' },
  minimumDesktopVersion: '0.1.0',
  nativeAuth: {
    authorizationPath: '/api/auth/native/authorize',
    browserHandoffPath: '/account',
    flow: 'system_browser_pkce',
    refreshPath: '/api/auth/native/refresh',
    supported: true,
    tokenPath: '/api/auth/native/token'
  }
}

describe('native authentication boundary', () => {
  beforeEach(() => {
    cancelPendingNativeAuth()
    vi.restoreAllMocks()
    mocks.openExternal.mockReset()
    mocks.encryptionAvailable = true
    mocks.storeAuthSession.mockReset()
    mocks.getAuthSession.mockReset()
    mocks.storeAuthSession.mockReturnValue(true)
    mocks.getAuthSession.mockReturnValue(session)
  })

  it('uses the existing browser session handoff and binds it to a one-time PKCE verifier', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(discovery))
    vi.stubGlobal('fetch', fetchMock)

    await startNativeSignIn()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const handoffUrl = new URL(String(mocks.openExternal.mock.calls[0]?.[0]))
    const codeChallenge = handoffUrl.searchParams.get('desktop_code_challenge')
    expect(handoffUrl.origin).toBe('https://www.getoverlay.io')
    expect(handoffUrl.pathname).toBe('/account')
    expect(codeChallenge?.length).toBeGreaterThanOrEqual(43)

    const codeVerifier = consumeSessionTransferVerifier('https://www.getoverlay.io')
    expect(codeVerifier).not.toBeNull()
    expect(createHash('sha256').update(codeVerifier!, 'ascii').digest('base64url')).toBe(
      codeChallenge
    )
    expect(consumeSessionTransferVerifier('https://www.getoverlay.io')).toBeNull()
  })

  it('rejects malformed or cross-origin browser handoff discovery paths', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          ...discovery,
          nativeAuth: { ...discovery.nativeAuth, browserHandoffPath: '//evil.example/account' }
        })
      )
    )
    await expect(startNativeSignIn()).rejects.toThrow('native_auth_invalid_discovery_path')

    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('fails before opening the browser when macOS protected storage is unavailable', async () => {
    mocks.encryptionAvailable = false
    vi.stubGlobal('fetch', vi.fn())

    await expect(startNativeSignIn()).rejects.toThrow('native_auth_secure_storage_unavailable')
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}
