import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AuthConfigurationError,
  AuthError,
  InvalidTokenError,
  UnauthorizedError,
  isAuthError,
} from './index'
import type { AuthProvider, Session } from './types'

describe('@overlay/auth-contracts', () => {
  it('exposes auth error subclasses with stable codes', () => {
    assert.equal(new UnauthorizedError().code, 'unauthorized')
    assert.equal(new InvalidTokenError().code, 'invalid_token')
    assert.equal(new AuthConfigurationError().code, 'configuration')
    assert.equal(isAuthError(new AuthError('x')), true)
    assert.equal(isAuthError(new Error('x')), false)
  })

  it('allows a minimal AuthProvider implementation', async () => {
    const provider: AuthProvider = {
      async getSession(): Promise<Session | null> {
        return null
      },
      async verifyAccessToken() {
        return null
      },
      async getUserProfile() {
        return null
      },
    }

    assert.equal(await provider.getSession(new Request('https://example.com')), null)
  })
})
