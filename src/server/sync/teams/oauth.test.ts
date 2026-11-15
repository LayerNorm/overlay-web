import { test } from 'node:test'
import assert from 'node:assert/strict'
import { idTokenClaims, openTeamsState, sealTeamsState, teamsAdminConsentUrl, teamsMemberAuthorizeUrl, teamsRedirectUri } from './oauth'

process.env.SESSION_SECRET = 'teams-oauth-test-secret'

test('state round-trips only for the flow it was minted for', () => {
  const sealed = sealTeamsState({ purpose: 'connect', workspaceId: 'ws', userId: 'u1', returnTo: '/app/settings' })
  assert.deepEqual(openTeamsState(sealed, 'connect'), { purpose: 'connect', workspaceId: 'ws', userId: 'u1', returnTo: '/app/settings' })
  assert.equal(openTeamsState(sealed, 'account'), null)
  assert.equal(openTeamsState(sealed.slice(0, -2) + 'xx', 'connect'), null)
  assert.equal(openTeamsState(null, 'connect'), null)
})

test('expired state is rejected', () => {
  const realNow = Date.now
  const sealed = sealTeamsState({ purpose: 'account', workspaceId: 'ws', userId: 'u1' })
  Date.now = () => realNow() + 11 * 60 * 1000
  try {
    assert.equal(openTeamsState(sealed, 'account'), null)
  } finally {
    Date.now = realNow
  }
})

test('consent and sign-in URLs', () => {
  const consent = new URL(teamsAdminConsentUrl({ clientId: 'app', redirectUri: teamsRedirectUri('https://x.test/', 'connect'), state: 's' }))
  assert.equal(consent.origin + consent.pathname, 'https://login.microsoftonline.com/organizations/v2.0/adminconsent')
  assert.equal(consent.searchParams.get('redirect_uri'), 'https://x.test/api/v1/sync/teams/callback')
  assert.equal(consent.searchParams.get('scope'), 'https://graph.microsoft.com/.default')
  const signIn = new URL(teamsMemberAuthorizeUrl({ clientId: 'app', tenantId: 'tenant-1', redirectUri: teamsRedirectUri('https://x.test', 'account'), state: 's' }))
  assert.equal(signIn.pathname, '/tenant-1/oauth2/v2.0/authorize')
  assert.equal(signIn.searchParams.get('scope'), 'openid profile offline_access User.Read ChannelMessage.Send')
  assert.equal(signIn.searchParams.get('redirect_uri'), 'https://x.test/api/v1/sync/teams/account/callback')
})

test('id token claims are read without trusting malformed tokens', () => {
  const payload = Buffer.from(JSON.stringify({ tid: 't1', oid: 'o1', name: 'Ada' })).toString('base64url')
  assert.deepEqual(idTokenClaims('h.' + payload + '.s'), { tid: 't1', oid: 'o1', name: 'Ada' })
  assert.deepEqual(idTokenClaims('garbage'), {})
  assert.deepEqual(idTokenClaims(undefined), {})
})
