import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertSingleWorkspaceInstall, openSlackConnectState, sanitizeSlackReturnTo, sealSlackConnectState, slackIdentityFromCode,
  slackInstallErrorCode, slackInstallUrl, SLACK_BOT_SCOPES,
} from './slack-app'

process.env.SESSION_SECRET ??= 'test-session-secret-for-slack-state'

const config = { clientId: 'client', clientSecret: 'secret', signingSecret: 'signing', encryptionKey: 'key' }

test('connect state round-trips and rejects tampering, expiry and unknown kinds', () => {
  const now = 1_000_000
  const sealed = sealSlackConnectState({ kind: 'link', userId: 'u1', workspaceId: 'w1', returnTo: '/app/settings' }, now)
  assert.deepEqual(openSlackConnectState(sealed, now + 1000), { kind: 'link', userId: 'u1', workspaceId: 'w1', returnTo: '/app/settings' })
  assert.equal(openSlackConnectState(sealed, now + 11 * 60_000), null)
  const [payload, signature] = sealed.split('.')
  const forged = Buffer.from(JSON.stringify({ kind: 'install', userId: 'u2', workspaceId: 'w1', expiresAt: now + 60_000 })).toString('base64url')
  assert.equal(openSlackConnectState(forged + '.' + signature, now), null)
  assert.equal(openSlackConnectState(payload + '.x', now), null)
  assert.equal(openSlackConnectState(null), null)
})

test('return targets stay on this deployment', () => {
  assert.equal(sanitizeSlackReturnTo('/app/settings?section=connected-apps'), '/app/settings?section=connected-apps')
  assert.equal(sanitizeSlackReturnTo('//evil.example'), undefined)
  for (const escape of ['/\\evil.example', '/\t/evil.example', '/%09/evil.example/../\\evil.example', '/\n//evil.example', '/\\/evil.example']) {
    assert.equal(sanitizeSlackReturnTo(escape), undefined, escape)
  }
  assert.equal(sanitizeSlackReturnTo('/%09/x'), '/%09/x')
  assert.equal(sanitizeSlackReturnTo('https://evil.example'), undefined)
})

test('the install URL asks for the Phase 1 bot scopes only', () => {
  const url = new URL(slackInstallUrl(config, 'state', 'https://overlay.test/api/v1/integrations/slack/oauth'))
  assert.equal(url.searchParams.get('scope'), SLACK_BOT_SCOPES.join(','))
  assert.equal(url.searchParams.get('state'), 'state')
  assert.ok(!SLACK_BOT_SCOPES.some((scope) => scope === 'chat:write.customize'))
})

test('Sign in with Slack identity comes from the OpenID token claims', async () => {
  const claims = { sub: 'U1', 'https://slack.com/team_id': 'T1', 'https://slack.com/user_id': 'U1', name: 'Ada' }
  const idToken = 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s'
  const fetchImpl = (async () => new Response(JSON.stringify({ ok: true, id_token: idToken }))) as typeof fetch
  assert.deepEqual(await slackIdentityFromCode(config, 'code', 'https://overlay.test/cb', fetchImpl), { teamId: 'T1', slackUserId: 'U1', name: 'Ada' })
  const failing = (async () => new Response(JSON.stringify({ ok: false, error: 'invalid_code' }))) as typeof fetch
  await assert.rejects(slackIdentityFromCode(config, 'code', 'https://overlay.test/cb', failing), /invalid_code/)
})

test('an org-wide Enterprise Grid install is refused with its own reason', () => {
  assert.doesNotThrow(() => assertSingleWorkspaceInstall({ isEnterpriseInstall: false }))
  assert.doesNotThrow(() => assertSingleWorkspaceInstall({}))
  let refused: unknown
  try {
    assertSingleWorkspaceInstall({ isEnterpriseInstall: true })
  } catch (error) {
    refused = error
  }
  assert.equal(slackInstallErrorCode(refused), 'enterprise_install')
  assert.equal(slackInstallErrorCode(new Error('[CONVEX] SLACK_TEAM_IN_OTHER_WORKSPACE')), 'other_workspace')
  assert.equal(slackInstallErrorCode(new Error('network down')), 'install_failed')
})
