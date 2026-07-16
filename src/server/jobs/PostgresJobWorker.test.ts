import assert from 'node:assert/strict'
import test from 'node:test'
import type { DurableJobRepository } from './DurableJobRepository'
import { PostgresJobWorker } from './PostgresJobWorker'

test('worker only asks the repository for job types supported by its image', async () => {
  let supportedTypes: readonly string[] | undefined
  const repository: DurableJobRepository = {
    enqueue: async () => 'unused',
    claim: async (args) => {
      supportedTypes = args.supportedTypes
      return null
    },
    complete: async () => true,
    fail: async () => 'retry',
    recoverExpiredLeases: async () => ({ deadLettered: 0, requeued: 0 }),
    renewLease: async () => true,
  }
  const worker = new PostgresJobWorker({
    handlers: {
      'release.current': async () => ({ ok: true }),
      'release.shared': async () => ({ ok: true }),
    },
    leaseMs: 5_000,
    repository,
    workerId: 'worker_current',
  })

  assert.equal(await worker.runOnce(), 'idle')
  assert.deepEqual(supportedTypes?.slice().sort(), ['release.current', 'release.shared'])
})
