import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bootstrapStatus: 200,
  authStateReads: 0,
  clearSessionAfterBootstrap: false
}))

vi.mock('./app-api-client', () => ({
  overlayDesktopAppClient: {
    bootstrap: {
      getResponse: vi.fn(
        async () =>
          new Response(null, {
            status: mocks.bootstrapStatus,
            headers: undefined
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
            session:
              mocks.clearSessionAfterBootstrap && mocks.authStateReads++ > 0
                ? null
                : {
                    authenticated: true,
                    user: { id: 'user_12345', email: 'user@example.test' }
                  }
          }))
        }
      }
    })
    mocks.bootstrapStatus = 200
    mocks.authStateReads = 0
    mocks.clearSessionAfterBootstrap = false
  })

  it('returns the stored identity only after authenticated bootstrap succeeds', async () => {
    const { loadVerifiedAuthSession } = await import('./auth-service')
    await expect(loadVerifiedAuthSession()).resolves.toMatchObject({
      authenticated: true,
      user: { id: 'user_12345' }
    })
  })

  it('preserves the local session when bootstrap is temporarily unavailable', async () => {
    mocks.bootstrapStatus = 503
    const { getAuthFailureMessage, loadVerifiedAuthSession } = await import('./auth-service')
    await expect(loadVerifiedAuthSession()).resolves.toMatchObject({
      authenticated: true,
      user: { id: 'user_12345' }
    })
    expect(getAuthFailureMessage()).toContain('could not be reached')
  })

  it('reports expiry only when the main process clears a terminally invalid session', async () => {
    mocks.bootstrapStatus = 401
    mocks.clearSessionAfterBootstrap = true
    const { getAuthFailureMessage, loadVerifiedAuthSession } = await import('./auth-service')
    await expect(loadVerifiedAuthSession()).resolves.toBeNull()
    expect(getAuthFailureMessage()).toContain('session expired')
  })
})
