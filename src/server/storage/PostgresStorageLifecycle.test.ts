import assert from 'node:assert/strict'
import test from 'node:test'
import type { DurableJob } from '@/server/jobs/DurableJobRepository'
import { createStorageDeleteJobHandler } from './PostgresStorageCleanupJobs'

function job(payload: Record<string, unknown>): DurableJob {
  return {
    attempts: 1,
    availableAt: Date.now(),
    id: 'job_1',
    maxAttempts: 5,
    payload,
    priority: 0,
    status: 'running',
    type: 'storage.delete-objects',
  }
}

test('storage cleanup handler deletes only owned keys and heartbeats batches', async () => {
  const deleted: string[] = []
  let heartbeats = 0
  const handler = createStorageDeleteJobHandler({
    deleteObject: async (key) => { deleted.push(key) },
  })
  const keys = Array.from({ length: 26 }, (_, index) => `users/user_1/files/${index}/file.txt`)
  const result = await handler(job({ keys, userId: 'user_1', reason: 'test' }), {
    heartbeat: async () => { heartbeats += 1; return true },
  })
  assert.deepEqual(deleted, keys)
  assert.equal(heartbeats, 1)
  assert.deepEqual(result, { deleted: 26, reason: 'test' })
})

test('storage cleanup handler rejects cross-user and duplicate keys', async () => {
  const handler = createStorageDeleteJobHandler({ deleteObject: async () => {} })
  await assert.rejects(handler(job({
    keys: ['users/other/files/1/file.txt'],
    userId: 'user_1',
  }), { heartbeat: async () => true }), /invalid or duplicate/)
  await assert.rejects(handler(job({
    keys: ['users/user_1/files/1/file.txt', 'users/user_1/files/1/file.txt'],
    userId: 'user_1',
  }), { heartbeat: async () => true }), /invalid or duplicate/)
})
