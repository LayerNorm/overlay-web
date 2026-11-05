import assert from 'node:assert/strict'
import test from 'node:test'
import { nativeConvexAuthEnabled, resolveNativeConvexToken } from './native-convex-token'

const session = { accessToken: 'provider-jwt', user: { id: 'user-a', email: 'qa@example.test' } }
const claims = { iss: 'https://issuer.example.test', sub: 'user-a', exp: Math.floor(Date.now() / 1000) + 300 }

test('returns only the verified upstream token for the exact application user', async () => {
  assert.equal(await resolveNativeConvexToken(session, async (token) => {
    assert.equal(token, session.accessToken)
    return claims
  }), 'provider-jwt')
  assert.equal(await resolveNativeConvexToken(session, async () => null), null)
  assert.equal(await resolveNativeConvexToken(session, async () => ({ ...claims, sub: 'user-b' })), null)
  assert.equal(await resolveNativeConvexToken(session, async () => ({ ...claims, exp: 1 })), null)
})

test('old private backends retain legacy auth until their native config is deployed and enabled', () => {
  assert.equal(nativeConvexAuthEnabled('workos'), true)
  assert.equal(nativeConvexAuthEnabled('workos', 'false'), false)
  for (const provider of ['better-auth', 'oidc']) {
    assert.equal(nativeConvexAuthEnabled(provider), false)
    assert.equal(nativeConvexAuthEnabled(provider, 'true'), true)
  }
})
