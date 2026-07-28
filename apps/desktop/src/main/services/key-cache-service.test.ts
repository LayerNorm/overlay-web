import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: {
    accessToken: 'old-access-token',
    refreshToken: 'refresh-token',
    user: { id: 'user_12345', email: 'user@example.test' }
  },
  storeAuthSession: vi.fn(),
  clearAuthSession: vi.fn(),
  sendToRenderer: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: mocks.sendToRenderer }
      }
    ]
  }
}))

vi.mock('./security/safe-storage-service', () => ({
  safeStorageService: {
    getAuthSession: () => mocks.session,
    storeAuthSession: mocks.storeAuthSession,
    clearAuthSession: mocks.clearAuthSession
  }
}))

vi.mock('./security/server-profile-service', () => ({
  serverProfileService: {
    getActiveOrigin: () => 'https://overlay.example.test'
  }
}))

vi.mock('./ai/gateway-provider', () => ({
  resetProviders: vi.fn()
}))

describe('KeyCacheService unauthorized recovery', () => {
  beforeEach(() => {
    mocks.storeAuthSession.mockReset()
    mocks.clearAuthSession.mockReset()
    mocks.sendToRenderer.mockReset()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            session: {
              accessToken: 'new-access-token',
              refreshToken: 'new-refresh-token',
              user: { id: 'user_12345', email: 'user@example.test' }
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
  })

  it('deduplicates concurrent refreshes and suppresses a second rejected-token rotation', async () => {
    const { KeyCacheService } = await import('./key-cache-service')
    const service = new KeyCacheService()
    service.setAccessToken('old-access-token')

    await expect(
      Promise.all([
        service.recoverAccessTokenAfterUnauthorized('old-access-token'),
        service.recoverAccessTokenAfterUnauthorized('old-access-token'),
        service.recoverAccessTokenAfterUnauthorized('old-access-token')
      ])
    ).resolves.toEqual([true, true, true])

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(service.getAccessToken()).toBe('new-access-token')

    await expect(
      service.recoverAccessTokenAfterUnauthorized('new-access-token')
    ).resolves.toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('allows a later recovery after the current token has been accepted', async () => {
    const { KeyCacheService } = await import('./key-cache-service')
    const service = new KeyCacheService()
    service.setAccessToken('old-access-token')

    await service.recoverAccessTokenAfterUnauthorized('old-access-token')
    service.markAccessTokenAccepted('new-access-token')

    await expect(
      service.recoverAccessTokenAfterUnauthorized('new-access-token')
    ).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('clears an invalid session and emits one global expired-session event', async () => {
    const { KeyCacheService } = await import('./key-cache-service')
    const service = new KeyCacheService()
    service.setAccessToken('rejected-access-token')

    service.forceSignOutForInvalidSession()
    service.forceSignOutForInvalidSession()

    expect(service.getAccessToken()).toBeNull()
    expect(mocks.clearAuthSession).toHaveBeenCalledTimes(1)
    expect(mocks.sendToRenderer).toHaveBeenCalledTimes(1)
    expect(mocks.sendToRenderer).toHaveBeenCalledWith('auth:force-sign-out', {
      reason: 'session_expired'
    })
  })

  it('preserves the stored session when refresh is temporarily unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: 'Session refresh is temporarily unavailable',
            code: 'refresh_temporarily_unavailable'
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
    const { KeyCacheService } = await import('./key-cache-service')
    const service = new KeyCacheService()
    service.setAccessToken('expired-access-token')

    await expect(service.refreshAccessTokenIfPossible()).resolves.toBe(false)
    expect(service.getAccessToken()).toBe('expired-access-token')
    expect(mocks.clearAuthSession).not.toHaveBeenCalled()
    expect(mocks.sendToRenderer).not.toHaveBeenCalled()
  })

  it('clears the session only for a definitive invalid refresh token response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: 'Invalid or expired refresh token',
            code: 'invalid_refresh_token'
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
    const { KeyCacheService } = await import('./key-cache-service')
    const service = new KeyCacheService()
    service.setAccessToken('expired-access-token')

    await expect(service.refreshAccessTokenIfPossible()).resolves.toBe(false)
    expect(service.getAccessToken()).toBeNull()
    expect(mocks.clearAuthSession).toHaveBeenCalledTimes(1)
    expect(mocks.sendToRenderer).toHaveBeenCalledTimes(1)
  })

  it('does not trust an ambiguous legacy 401 enough to destroy the session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'Invalid or expired refresh token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    )
    const { KeyCacheService } = await import('./key-cache-service')
    const service = new KeyCacheService()
    service.setAccessToken('expired-access-token')

    await expect(service.refreshAccessTokenIfPossible()).resolves.toBe(false)
    expect(service.getAccessToken()).toBe('expired-access-token')
    expect(mocks.clearAuthSession).not.toHaveBeenCalled()
  })
})
