import assert from 'node:assert/strict'
import test from 'node:test'

// Set before any cipher call; fromEnvironment() reads process.env lazily, inside seal/open.
process.env.MCP_CREDENTIAL_ENCRYPTION_KEY ??= 'mcp-oauth-test-encryption-key-that-is-long-enough'

import {
  hashSessionBinding,
  mcpOAuthRedirectUri,
  openOAuthConfirmation,
  sealOAuthConfirmation,
} from './mcp-oauth'

test('the OAuth redirect URI is stable regardless of trailing slashes', () => {
  assert.equal(
    mcpOAuthRedirectUri('https://www.getoverlay.io'),
    'https://www.getoverlay.io/api/v1/mcps/oauth/callback',
  )
  assert.equal(
    mcpOAuthRedirectUri('https://www.getoverlay.io/'),
    'https://www.getoverlay.io/api/v1/mcps/oauth/callback',
  )
})

test('session binding is a one-way hash, not the session value', () => {
  const hash = hashSessionBinding('user_123')
  assert.notEqual(hash, 'user_123')
  assert.equal(hash.includes('user_123'), false)
  assert.equal(hash, hashSessionBinding('user_123'))
  assert.notEqual(hash, hashSessionBinding('user_124'))
})

test('a desktop confirmation round-trips without exposing the code in the cookie', () => {
  const sealed = sealOAuthConfirmation({
    authorizationCode: 'auth-code-secret',
    codeVerifier: 'verifier-secret',
    mcpServerId: 'mcp_1',
    userId: 'user_1',
  })

  assert.equal(sealed.includes('auth-code-secret'), false)
  assert.equal(sealed.includes('verifier-secret'), false)

  const opened = openOAuthConfirmation(sealed)
  assert.equal(opened?.authorizationCode, 'auth-code-secret')
  assert.equal(opened?.codeVerifier, 'verifier-secret')
  assert.equal(opened?.mcpServerId, 'mcp_1')
  assert.equal(opened?.userId, 'user_1')
})

test('a tampered or absent confirmation cookie is refused', () => {
  assert.equal(openOAuthConfirmation(undefined), null)
  assert.equal(openOAuthConfirmation(''), null)
  assert.equal(openOAuthConfirmation('not-a-sealed-value'), null)

  const sealed = sealOAuthConfirmation({
    authorizationCode: 'code',
    codeVerifier: 'verifier',
    mcpServerId: 'mcp_1',
    userId: 'user_1',
  })
  // Flipping any character must fail authentication rather than yield a usable payload.
  const tampered = `${sealed.slice(0, -2)}${sealed.slice(-2) === 'AA' ? 'BB' : 'AA'}`
  assert.equal(openOAuthConfirmation(tampered), null)
})
