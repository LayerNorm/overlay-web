import assert from 'node:assert/strict'
import test from 'node:test'
import {driveRecoveryRequestSchema, driveRecoveryResultSchema} from './drive-recovery.js'

test('drive recovery accepts only a bounded receipt identity without storage keys, tokens or host-selected scope', () => {
  const request = {action: 'recover', requestId: 'original-request-001', previousExecution: {attemptId: 'old', generation: 1},
    kind: 'content', fingerprint: '["create","file.md"]'}
  assert.equal(driveRecoveryRequestSchema.safeParse(request).success, true)
  for (const extra of [{scope: 'workspace'}, {token: 'secret'}, {stagingKey: 'object'}, {uploadId: 'foreign'},
    {fingerprint: 'x'.repeat(16385)}, {previousExecution: {attemptId: 'old', generation: 0}}])
    assert.equal(driveRecoveryRequestSchema.safeParse({...request, ...extra}).success, false)
  const result = {requestId: request.requestId, previousExecution: request.previousExecution, resolution: {state: 'uncommitted'}}
  assert.equal(driveRecoveryResultSchema.safeParse(result).success, true)
  assert.equal(driveRecoveryResultSchema.safeParse({...result, resolution: {state: 'pending'}}).success, false)
  assert.equal(driveRecoveryResultSchema.safeParse({...result, resolution: {state: 'uncommitted', stagingKey: 'object'}}).success, false)
})
