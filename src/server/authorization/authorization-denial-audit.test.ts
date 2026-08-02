import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuditService } from '@/server/admin/AuditService'
import { recordAuthorizationDenial } from './authorization-denial-audit'

type RecordedAudit = Parameters<AuditService['record']>[0]

test('mutation denials produce a minimal redacted audit event', async () => {
  const records: RecordedAudit[] = []
  const recorded = await recordAuthorizationDenial({
    auditService: { async record(input) { records.push(input) } },
    actor: { authType: 'api-key', apiKeyId: 'key_1', userId: 'user_1' },
    capability: 'files.delete',
    clientIp: '203.0.113.1',
    method: 'DELETE',
    pathname: '/api/v1/files/file_2',
    reason: 'resource_access_missing',
    requestId: 'request_1',
    resourceId: 'file_2',
    resourceType: 'file',
  })

  assert.equal(recorded, true)
  assert.equal(records.length, 1)
  assert.deepEqual(records[0], {
    action: 'authorization.request.denied',
    actorApiKeyId: 'key_1',
    actorType: 'api_key',
    actorUserId: 'user_1',
    ipAddress: '203.0.113.1',
    metadata: {
      capability: 'files.delete',
      method: 'DELETE',
      pathname: '/api/v1/files/file_2',
      reason: 'resource_access_missing',
    },
    outcome: 'denied',
    requestId: 'request_1',
    resourceId: 'file_2',
    resourceType: 'file',
  })
  assert.equal(JSON.stringify(records[0]).includes('body'), false)
  assert.equal(JSON.stringify(records[0]).includes('authorization'), true)
  assert.equal(JSON.stringify(records[0]).includes('cookie'), false)
  assert.equal(JSON.stringify(records[0]).includes('token'), false)
})

test('read denials are not persisted and audit failures never mask authorization', async () => {
  let calls = 0
  const readRecorded = await recordAuthorizationDenial({
    auditService: { async record() { calls += 1 } },
    actor: { authType: 'session', userId: 'user_1' },
    clientIp: '203.0.113.1',
    method: 'GET',
    pathname: '/api/v1/files/file_2',
    reason: 'resource_access_missing',
  })
  const failedRecorded = await recordAuthorizationDenial({
    auditService: { async record() { throw new Error('audit unavailable') } },
    actor: { authType: 'session', userId: 'user_1' },
    clientIp: '203.0.113.1',
    method: 'POST',
    pathname: '/api/v1/files',
    reason: 'capability_missing',
  })

  assert.equal(readRecorded, false)
  assert.equal(failedRecorded, false)
  assert.equal(calls, 0)
})
