import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bootstrapStatus: 200,
  bootstrapChallenge: ''
}))

vi.mock('./app-api-client', () => ({
  overlayDesktopAppClient: {
    bootstrap: {
      getResponse: vi.fn(
        async () =>
          new Response(null, {
            status: mocks.bootstrapStatus,
            headers: mocks.bootstrapChallenge
              ? { 'WWW-Authenticate': mocks.bootstrapChallenge }
              : undefined
          })
      )
    }
  }
}))

describe('renderer auth readiness', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      bridge: {
        security: {
          getAuthState: vi.fn(async () => ({
            session: {
              authenticated: true,
              user: { id: 'user_12345', email: 'user@example.test' }
            }
          }))
        }
      }
    })
    mocks.bootstrapStatus = 200
    mocks.bootstrapChallenge = ''
  })

  it('returns the stored identity only after authenticated bootstrap succeeds', async () => {
    const { loadVerifiedAuthSession } = await import('./auth-service')
    await expect(loadVerifiedAuthSession()).resolves.toMatchObject({
      authenticated: true,
      user: { id: 'user_12345' }
    })
  })

  it('does not expose auth-ready state when bootstrap rejects the session', async () => {
    mocks.bootstrapStatus = 401
    const { getAuthFailureMessage, loadVerifiedAuthSession } = await import('./auth-service')
    await expect(loadVerifiedAuthSession()).resolves.toBeNull()
    expect(getAuthFailureMessage()).toContain('could not be reached')
  })

  it('labels only an explicit invalid-token challenge as an expired session', async () => {
    mocks.bootstrapStatus = 401
    mocks.bootstrapChallenge = 'Bearer error="invalid_token"'
    const { getAuthFailureMessage, loadVerifiedAuthSession } = await import('./auth-service')
    await expect(loadVerifiedAuthSession()).resolves.toBeNull()
    expect(getAuthFailureMessage()).toContain('session expired')
  })
})
