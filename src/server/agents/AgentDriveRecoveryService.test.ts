import assert from 'node:assert/strict'
import test from 'node:test'
import {AgentDriveRecoveryService} from './AgentDriveRecoveryService'
import {createAgentDriveTokens} from './agent-drive-token'

test('receipt service rejects invalid tokens and mismatched or malformed backend outcomes', async () => {
  const tokens = createAgentDriveTokens({secret: 'recovery-tests-only'.padEnd(40, '0')})
  const claims = {actorUserId: 'u', agentId: 'a', environmentId: 'e', bindingId: 'b', runId: 'r', sessionId: 'next',
    scope: {kind: 'personal' as const, workspaceId: 'w', ownerUserId: 'u'}, execution: {attemptId: 'next', generation: 2}}
  const token = tokens.mint(claims, Date.now() + 60000)
  const request = {action: 'recover' as const, requestId: 'original-request-001', previousExecution: {attemptId: 'old', generation: 1},
    kind: 'content' as const, fingerprint: 'original-operation'}
  let calls = 0
  let outcome: unknown = {requestId: request.requestId, previousExecution: request.previousExecution, resolution: {state: 'uncommitted'}}
  const service = new AgentDriveRecoveryService({verifyToken: tokens.verify, read: async (current, body) => {
    calls++; assert.equal(current.sessionId, 'next'); assert.deepEqual(body, request); return outcome
  }})
  await assert.rejects(service.recover(null, request), /DRIVE_UNAUTHORIZED/)
  assert.equal(calls, 0)
  assert.deepEqual(await service.recover(token, request), outcome)
  for (const changed of [{requestId: 'foreign-request-001'}, {previousExecution: {attemptId: 'foreign', generation: 1}},
    {previousExecution: {attemptId: 'old', generation: 2}}, {resolution: {state: 'metadata_committed', result: {fileId: 'file', updatedAt: 1}}}]) {
    outcome = {requestId: request.requestId, previousExecution: request.previousExecution, resolution: {state: 'uncommitted'}, ...changed}
    await assert.rejects(service.recover(token, request), /DRIVE_RECOVERY_UNAVAILABLE/)
  }
  outcome = {requestId: request.requestId, previousExecution: request.previousExecution, resolution: {state: 'uncommitted', finalKey: 'secret'}}
  await assert.rejects(service.recover(token, request))
})
