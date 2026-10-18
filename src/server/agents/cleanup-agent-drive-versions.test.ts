import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanupDriveVersions } from './cleanup-agent-drive-versions'

test('retired drive bytes release quota only after deletion, absence readback and matching acknowledgement', async () => {
  const calls: string[] = []
  const result = await cleanupDriveVersions({
    claim: async claim => { assert.match(claim, /^[a-f0-9-]{36}$/); return { objects: [{ id: 'retired', key: 'old-version' }], convexDeleted: 0 } },
    deleteObject: async key => { calls.push(`delete:${key}`) },
    absent: async key => { calls.push(`absent:${key}`); return true },
    acknowledge: async ({ id, key }) => { calls.push(`ack:${id}:${key}`); return true },
  })
  assert.deepEqual(calls, ['delete:old-version', 'absent:old-version', 'ack:retired:old-version'])
  assert.deepEqual(result, { deleted: 1, deferred: 0 })
})

test('storage failures, retained objects and lost acknowledgements remain durable and charged', async () => {
  for (const failure of ['delete', 'head', 'present', 'ack', 'stale']) {
    let acknowledgements = 0
    const result = await cleanupDriveVersions({
      claim: async () => ({ objects: [{ id: 'retired', key: 'old-version' }], convexDeleted: 0 }),
      deleteObject: async () => { if (failure === 'delete') throw Error('storage timeout') },
      absent: async () => { if (failure === 'head') throw Error('readback timeout'); return failure !== 'present' },
      acknowledge: async () => { acknowledgements++; if (failure === 'ack') throw Error('lost acknowledgement'); return false },
    })
    assert.deepEqual(result, { deleted: 0, deferred: 1 }, failure)
    assert.equal(acknowledgements, ['ack', 'stale'].includes(failure) ? 1 : 0)
  }
})
