import 'server-only'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { assertCurrentDriveRun, createAgentDriveTokens, type AgentDriveTokenClaims } from './agent-drive-token'

const secret = 'drive-tests-only-signing-secret-32-bytes'
const input = {
  actorUserId: 'owner', agentId: 'agent', environmentId: 'environment', bindingId: 'binding', runId: 'run', sessionId: 'session',
  scope: { kind: 'personal' as const, workspaceId: 'workspace', ownerUserId: 'owner' },
  execution: { attemptId: 'attempt', generation: 1 },
}

test('drive tokens have a fixed scope, exact run/attempt and bounded deadline', () => {
  let clock = 1000
  const tokens = createAgentDriveTokens({ secret, now: () => clock })
  const token = tokens.mint(input, 5000)
  assert.equal(tokens.verify(token)?.expiresAt, 5000)
  assert.deepEqual(tokens.verify(token)?.execution, input.execution)
  assert.deepEqual(tokens.verify(token)?.scope, input.scope)
  assert.equal(tokens.verify(tokens.mint(input, 10_000_000))?.expiresAt, clock + 60 * 60_000)
  clock = 5000
  assert.equal(tokens.verify(token), null)
  assert.throws(() => tokens.mint(input, clock), /DRIVE_RUN_EXPIRED/)
  assert.throws(() => tokens.mint({ ...input, actorUserId: 'other' }, 6000), /DRIVE_PERSONAL_OWNER_MISMATCH/)
})

test('forged scope, another signing key, malformed fields and other credential purposes are rejected', () => {
  const tokens = createAgentDriveTokens({ secret, now: () => 1000 })
  const token = tokens.mint(input, 5000)
  const [payload, mac] = token.slice('ovdrive_'.length).split('.')
  const changed = Buffer.from(JSON.stringify({ ...tokens.verify(token), scope: { kind: 'workspace', workspaceId: 'another' } })).toString('base64url')
  assert.equal(tokens.verify(`ovdrive_${changed}.${mac}`), null)
  assert.equal(createAgentDriveTokens({ secret: `${secret}-different`, now: () => 1000 }).verify(token), null)
  assert.equal(tokens.verify(`ovmcp_${payload}.${mac}`), null)
  assert.equal(tokens.verify(`${token}.extra`), null)
  assert.equal(tokens.verify('ovdrive_' + 'x'.repeat(9000)), null)
  const signed = (fields: Record<string, unknown>) => {
    const body = Buffer.from(JSON.stringify({ ...tokens.verify(token), ...fields })).toString('base64url')
    return `ovdrive_${body}.${createHmac('sha256', secret).update(`overlay-agent-drive:v1.${body}`).digest('base64url')}`
  }
  assert.equal(tokens.verify(signed({ audience: 'other' })), null)
  assert.equal(tokens.verify(signed({ storageSecret: 'must never be a claim' })), null)
  assert.equal(tokens.verify(signed({ issuedAt: 2000 })), null)
  assert.equal(tokens.verify(signed({ expiresAt: 10_000_000 })), null)
})

test('live server readback fences expiry, revoked membership, scope changes, Stop and old attempts', () => {
  const tokens = createAgentDriveTokens({ secret, now: () => 1000 })
  const claims = tokens.verify(tokens.mint(input, 5000))!
  const current = { ...input, bindingEnabled: true, environmentRevoked: false, actorIsMember: true, status: 'running', hardDeadlineAt: 5000 }
  assert.doesNotThrow(() => assertCurrentDriveRun(claims, current, 2000))
  for (const patch of [
    { bindingEnabled: false }, { environmentRevoked: true }, { actorIsMember: false },
    { status: 'cancelled' }, { status: 'cancelling' }, { status: 'completed' }, { status: 'needs_attention' },
    { hardDeadlineAt: 2000 }, { hardDeadlineAt: 4000 }, { agentId: 'other' }, { actorUserId: 'other' },
    { sessionId: 'new-session' }, { bindingId: 'new-binding' }, { runId: 'other-run' },
    { execution: { attemptId: 'attempt', generation: 2 } }, { execution: undefined },
    { scope: { kind: 'personal' as const, workspaceId: 'workspace', ownerUserId: 'other' } },
    { scope: { kind: 'workspace' as const, workspaceId: 'workspace' } },
  ]) assert.throws(() => assertCurrentDriveRun(claims, { ...current, ...patch }, 2000), /DRIVE_RUN_UNAVAILABLE/)
  assert.throws(() => assertCurrentDriveRun(claims, current, 5000), /DRIVE_RUN_UNAVAILABLE/)
  const legacy: AgentDriveTokenClaims = { ...claims, execution: undefined }
  assert.doesNotThrow(() => assertCurrentDriveRun(legacy, { ...current, execution: undefined }, 2000))
  assert.throws(() => assertCurrentDriveRun(legacy, { ...current, sessionId: 'replaced', execution: undefined }, 2000), /DRIVE_RUN_UNAVAILABLE/)
})
