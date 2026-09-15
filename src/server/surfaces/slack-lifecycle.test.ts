import 'server-only'

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'

import {
  extractSlackLifecycleAction,
  isSlackTokenRevokedError,
  verifySlackRequestSignature,
} from './slack-lifecycle'

function slackEnvelope(event: unknown, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'event_callback',
    team_id: 'T1',
    event_id: 'Ev1',
    event,
    ...overrides,
  })
}

test('extractSlackLifecycleAction reads app_uninstalled', () => {
  const action = extractSlackLifecycleAction(
    slackEnvelope({ type: 'app_uninstalled' }),
  )
  assert.equal(action?.type, 'app_uninstalled')
  assert.equal(action?.teamId, 'T1')
})

test('extractSlackLifecycleAction reads tokens_revoked when a bot token is revoked', () => {
  const action = extractSlackLifecycleAction(
    slackEnvelope({ type: 'tokens_revoked', tokens: { oauth: ['U1'], bot: ['U2'] } }),
  )
  assert.equal(action?.type, 'tokens_revoked')
  assert.equal(action?.teamId, 'T1')
})

test('extractSlackLifecycleAction ignores user-token revocations — the bot token still works', () => {
  assert.equal(
    extractSlackLifecycleAction(
      slackEnvelope({ type: 'tokens_revoked', tokens: { oauth: ['U1'], bot: [] } }),
    ),
    null,
  )
  assert.equal(
    extractSlackLifecycleAction(
      slackEnvelope({ type: 'tokens_revoked', tokens: { oauth: ['U1'] } }),
    ),
    null,
  )
})

test('extractSlackLifecycleAction ignores non-lifecycle and malformed payloads', () => {
  assert.equal(
    extractSlackLifecycleAction(slackEnvelope({ type: 'message', text: 'hi' })),
    null,
  )
  assert.equal(
    extractSlackLifecycleAction(JSON.stringify({ type: 'url_verification', challenge: 'x' })),
    null,
  )
  assert.equal(extractSlackLifecycleAction('not json'), null)
  assert.equal(extractSlackLifecycleAction(''), null)
})

test('extractSlackLifecycleAction falls back to authorization team/enterprise ids', () => {
  const action = extractSlackLifecycleAction(
    JSON.stringify({
      type: 'event_callback',
      authorizations: [{ team_id: 'T9', enterprise_id: 'E9' }],
      event: { type: 'app_uninstalled' },
    }),
  )
  assert.equal(action?.teamId, 'T9')
  assert.equal(action?.enterpriseId, 'E9')
})

const SIGNING_SECRET = 'test-signing-secret'

function signedHeaders(body: string, timestampSeconds: number, secret = SIGNING_SECRET): Headers {
  const signature = `v0=${createHmac('sha256', secret)
    .update(`v0:${timestampSeconds}:${body}`)
    .digest('hex')}`
  return new Headers({
    'x-slack-request-timestamp': String(timestampSeconds),
    'x-slack-signature': signature,
  })
}

test('verifySlackRequestSignature accepts a correctly signed body', () => {
  const now = 1_800_000_000_000
  const body = slackEnvelope({ type: 'app_uninstalled' })
  const headers = signedHeaders(body, Math.floor(now / 1000))
  assert.equal(
    verifySlackRequestSignature({ headers, body, signingSecret: SIGNING_SECRET, now }),
    true,
  )
})

test('verifySlackRequestSignature rejects tampered bodies and wrong secrets', () => {
  const now = 1_800_000_000_000
  const body = slackEnvelope({ type: 'app_uninstalled' })
  const headers = signedHeaders(body, Math.floor(now / 1000))
  // Body signed for a different payload.
  assert.equal(
    verifySlackRequestSignature({
      headers,
      body: slackEnvelope({ type: 'tokens_revoked' }),
      signingSecret: SIGNING_SECRET,
      now,
    }),
    false,
  )
  // Right body, wrong secret.
  const forged = signedHeaders(body, Math.floor(now / 1000), 'other-secret')
  assert.equal(
    verifySlackRequestSignature({ headers: forged, body, signingSecret: SIGNING_SECRET, now }),
    false,
  )
})

test('verifySlackRequestSignature rejects stale timestamps and missing headers', () => {
  const now = 1_800_000_000_000
  const body = slackEnvelope({ type: 'app_uninstalled' })
  const stale = signedHeaders(body, Math.floor(now / 1000) - 600)
  assert.equal(
    verifySlackRequestSignature({ headers: stale, body, signingSecret: SIGNING_SECRET, now }),
    false,
  )
  assert.equal(
    verifySlackRequestSignature({ headers: new Headers(), body, signingSecret: SIGNING_SECRET, now }),
    false,
  )
  assert.equal(
    verifySlackRequestSignature({
      headers: signedHeaders(body, Math.floor(now / 1000)),
      body,
      signingSecret: '',
      now,
    }),
    false,
  )
})

test('isSlackTokenRevokedError detects dead-token Slack errors', () => {
  assert.equal(isSlackTokenRevokedError({ data: { error: 'token_revoked' } }), true)
  assert.equal(isSlackTokenRevokedError({ data: { error: 'account_inactive' } }), true)
  assert.equal(isSlackTokenRevokedError({ code: 'invalid_auth' }), true)
  assert.equal(isSlackTokenRevokedError({ error: 'not_authed' }), true)
})

test('isSlackTokenRevokedError ignores ordinary Slack failures', () => {
  assert.equal(isSlackTokenRevokedError({ data: { error: 'channel_not_found' } }), false)
  assert.equal(isSlackTokenRevokedError({ data: { error: 'rate_limited' } }), false)
  assert.equal(isSlackTokenRevokedError(new Error('network')), false)
  assert.equal(isSlackTokenRevokedError(null), false)
  assert.equal(isSlackTokenRevokedError('token_revoked'), false)
})
