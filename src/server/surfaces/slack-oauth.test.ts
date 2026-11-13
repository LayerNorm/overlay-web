import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SLACK_SYNC_USER_SCOPES,
  exchangeSlackUserCode,
  openSlackConnectState,
  sealSlackConnectState,
  slackAuthorizeUrl,
} from './slack-oauth'

process.env.SESSION_SECRET = 'session-secret-for-tests'
process.env.SLACK_CLIENT_ID = 'client-id'
process.env.SLACK_CLIENT_SECRET = 'client-secret'
const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

test('member sign-in state round-trips and requests user scopes only', () => {
  const state = sealSlackConnectState({ purpose: 'sync_member', workspaceId: 'ws', userId: 'u1', returnTo: '/app/chats' })
  assert.deepEqual(openSlackConnectState(state), { purpose: 'sync_member', workspaceId: 'ws', userId: 'u1', returnTo: '/app/chats' })
  const url = new URL(slackAuthorizeUrl({ clientId: 'client-id', redirectUri: 'https://x/cb', state, userScopes: SLACK_SYNC_USER_SCOPES }))
  assert.equal(url.searchParams.get('user_scope'), 'chat:write,reactions:write')
  assert.equal(url.searchParams.get('scope'), null)
  assert.ok(new URL(slackAuthorizeUrl({ clientId: 'client-id', redirectUri: 'https://x/cb', state })).searchParams.get('scope')?.includes('chat:write'))
})

test('the code exchange returns the member grant from oauth.v2.access', async () => {
  let sent: URLSearchParams | undefined
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent = init.body as URLSearchParams
    return new Response(JSON.stringify({
      ok: true,
      app_id: 'A0KRD7HC3',
      authed_user: { id: 'U1234', scope: 'chat:write,reactions:write', access_token: 'xoxp-1234', token_type: 'user' },
      team: { id: 'T9TK3CUKW', name: 'Slack Softball Team' },
      enterprise: null,
      is_enterprise_install: false,
    }))
  }) as typeof fetch
  const grant = await exchangeSlackUserCode('code-1', 'https://x/cb')
  assert.deepEqual(grant, { teamId: 'T9TK3CUKW', userId: 'U1234', accessToken: 'xoxp-1234', scopes: ['chat:write', 'reactions:write'] })
  assert.equal(sent?.get('code'), 'code-1')
  assert.equal(sent?.get('client_secret'), 'client-secret')
})

test('a failed exchange names the Slack error without echoing secrets', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: 'invalid_code' }))) as typeof fetch
  await assert.rejects(exchangeSlackUserCode('bad', 'https://x/cb'), (error: unknown) => error instanceof Error && error.message.endsWith('invalid_code') && !error.message.includes('client-secret'))
})
