import assert from 'node:assert/strict'
import test from 'node:test'
import {
  openSlackIdentityState, sealSlackIdentityState, slackIdentityAuthorizeUrl, verifiedSlackIdentityClaims,
} from './slack-identity-oauth'

test('identity state is signed, scoped and distinct from install state', () => {
  process.env.SESSION_SECRET = 'test-only-slack-identity-key'
  const sealed = sealSlackIdentityState({ workspaceId: 'workspace', connectionId: 'connection', userId: 'user', teamId: 'T1' })
  assert.deepEqual(openSlackIdentityState(sealed.state), {
    workspaceId: 'workspace', connectionId: 'connection', userId: 'user', teamId: 'T1', nonce: sealed.nonce, returnTo: undefined,
  })
  assert.equal(openSlackIdentityState(`tampered${sealed.state}`), null)
  assert.equal(openSlackIdentityState(`${sealed.state}.extra`), null)
  const url = new URL(slackIdentityAuthorizeUrl({ clientId: 'client', redirectUri: 'https://example.test/callback', teamId: 'T1', ...sealed }))
  assert.equal(url.pathname, '/openid/connect/authorize')
  assert.equal(url.searchParams.get('scope'), 'openid')
  assert.equal(url.searchParams.get('nonce'), sealed.nonce)
})

test('verified claims bind the Slack team, subject and nonce without email matching', () => {
  const state = { workspaceId: 'workspace', connectionId: 'connection', userId: 'user', teamId: 'T1', nonce: 'nonce' }
  const claims = { sub: 'U1', nonce: 'nonce', 'https://slack.com/team_id': 'T1', 'https://slack.com/user_id': 'U1' }
  assert.deepEqual(verifiedSlackIdentityClaims(claims, state), { externalTeamId: 'T1', externalUserId: 'U1' })
  for (const patch of [{ nonce: 'other' }, { sub: 'U2' }, { 'https://slack.com/team_id': 'T2' }]) {
    assert.throws(() => verifiedSlackIdentityClaims({ ...claims, ...patch }, state))
  }
})

test('expired state cannot be used, and unsigned or malformed requests are rejected', t => {
  process.env.SESSION_SECRET = 'test-only-slack-identity-key'
  let now = 1_000_000
  t.mock.method(Date, 'now', () => now)
  const { state } = sealSlackIdentityState({ workspaceId: 'workspace', connectionId: 'connection', userId: 'user', teamId: 'T1' })
  now += 600_001
  assert.equal(openSlackIdentityState(state), null)
  for (const value of ['', 'unsigned', 'payload.signature', 'a'.repeat(4097)]) assert.equal(openSlackIdentityState(value), null)
})
