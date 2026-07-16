import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { durableJobs } from '@/server/database/postgres/schema'
import { PostgresDurableJobRepository, PostgresRuntimeHealthService } from '@/server/jobs'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test(
  'Postgres P5 operations telemetry',
  {
    skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for P5 operations contracts',
  },
  async (t) => {
    if (!connectionString) return
    const pool = createOverlayPostgresPool({
      connectionString,
      max: 3,
      sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
    })
    const db = createOverlayPostgresDb(pool)
    const repository = new PostgresDurableJobRepository(db)
    const scope = `p5d_${randomUUID()}`
    try {
      await db.delete(durableJobs)
      await repository.enqueue({
        availableAt: Date.now() - 10_000,
        dedupeKey: `${scope}:queued`,
        type: `${scope}.queued`,
      })
      const deadLetterId = await repository.enqueue({
        dedupeKey: `${scope}:dead`,
        maxAttempts: 1,
        priority: 10,
        type: `${scope}.dead`,
      })
      const claimed = await repository.claim({
        leaseMs: 5_000,
        workerId: `${scope}:worker`,
      })
      assert.equal(claimed?.id, deadLetterId)
      assert.equal(
        await repository.fail({
          error: 'P5d telemetry proof',
          jobId: deadLetterId,
          retryDelayMs: 0,
          workerId: `${scope}:worker`,
        }),
        'dead_letter',
      )

      await t.test('runtime health reports queue age and dead letters for CloudWatch metric filters', async () => {
        const health = await new PostgresRuntimeHealthService(db).read()
        assert.equal(health.deadLetterCount, 1)
        assert.equal(health.queuedCount, 1)
        assert.equal(health.runningCount, 0)
        assert.ok(health.oldestQueuedJobAgeSeconds >= 9)
      })
    } finally {
      await db.delete(durableJobs)
      await pool.end()
    }
  },
)
