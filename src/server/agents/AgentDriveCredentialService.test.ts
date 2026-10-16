import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentDriveCredentialService } from './AgentDriveCredentialService'
import { createAgentDriveTokens } from './agent-drive-token'

const secret = 'drive-credential-test-signing-secret-at-least-32'
const host = { workspaceId: 'workspace', environmentId: 'environment' }
const request = { runId: 'run', sessionId: 'session', execution: { attemptId: 'attempt', generation: 1 } }
const claims = { ...request, actorUserId: 'owner', agentId: 'agent', bindingId: 'binding', environmentId: host.environmentId,
  scope: { kind: 'personal' as const, workspaceId: host.workspaceId, ownerUserId: 'owner' }, expiresAt: 10_000_000 }

test('drive issuance and renewal use live persisted scope and never extend the hard deadline', async () => {
  let now = 1000
  const seen: unknown[] = []
  const service = new AgentDriveCredentialService({ secret, enabled: () => true, now: () => now,
    lookup: async input => { seen.push(input); return { claims, hardDeadlineAt: 5_000_000 } },
  })
  const first = await service.issue(host, request)
  const tokens = createAgentDriveTokens({ secret, now: () => now })
  assert.equal(first.expiresAt, now + 60 * 60000)
  assert.deepEqual(tokens.verify(first.token)?.scope, claims.scope)
  assert.equal(JSON.stringify(first).includes('binding'), false)
  now = first.expiresAt
  assert.equal(tokens.verify(first.token), null)
  const renewed = await service.issue(host, request)
  assert.equal(renewed.expiresAt, 5_000_000)
  assert.deepEqual(tokens.verify(renewed.token)?.execution, request.execution)
  assert.deepEqual(seen, [{ ...request, ...host }, { ...request, ...host }])
  now = 5_000_000
  await assert.rejects(service.issue(host, request), /DRIVE_RUN_EXPIRED/)
})

test('disabled feature, expired authority and substituted workspace/environment/session/attempt fail closed', async () => {
  const disabled = new AgentDriveCredentialService({ secret, enabled: () => false,
    lookup: async () => { throw Error('must not query') } })
  await assert.rejects(disabled.issue(host, request), /DRIVE_DISABLED/)
  for (const patch of [{ environmentId: 'foreign' }, { runId: 'foreign' }, { sessionId: 'foreign' },
    { scope: { ...claims.scope, workspaceId: 'foreign' } }, { execution: { attemptId: 'other', generation: 1 } },
    { execution: { attemptId: 'attempt', generation: 2 } }, { execution: undefined }]) {
    const service = new AgentDriveCredentialService({ secret, enabled: () => true, now: () => 1000,
      lookup: async () => ({ claims: { ...claims, ...patch }, hardDeadlineAt: 10_000_000 }) })
    await assert.rejects(service.issue(host, request), /DRIVE_RUN_UNAVAILABLE/)
  }
  const expired = new AgentDriveCredentialService({ secret, enabled: () => true, now: () => 1000,
    lookup: async () => ({ claims: { ...claims, expiresAt: 999 }, hardDeadlineAt: 10_000_000 }) })
  await assert.rejects(expired.issue(host, request), /DRIVE_RUN_EXPIRED/)
})

test('host-selected scope/owner fields and invalid backend envelopes never mint a credential', async () => {
  const service = new AgentDriveCredentialService({ secret, enabled: () => true,
    lookup: async () => ({ claims: { ...claims, storageSecret: 'must-not-cross' }, hardDeadlineAt: 10_000_000 }) })
  await assert.rejects(service.issue(host, request), /unrecognized_keys/)
  await assert.rejects(service.issue(host, { ...request, ...{ actorUserId: 'other' } }), /unrecognized_keys/)
})
