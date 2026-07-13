import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { eq, sql } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import {
  APP_DATA_MIGRATION_LOCK_ID,
  APP_DATA_SCHEMA_VERSION,
  assertAppDataSchemaCompatible,
  readAppDataSchemaCompatibility,
} from '@/server/database/postgres/schema-compatibility'
import { durableJobs, users } from '@/server/database/postgres/schema'
import { PostgresIdempotencyRepository } from '@/server/idempotency'
import { PostgresServiceAuthReplayRepository } from '@/server/auth/replay'
import {
  POSTGRES_RUNTIME_SCHEDULES,
  PostgresDurableJobRepository,
  PostgresOutboxRepository,
  PostgresSchedulerService,
} from '@/server/jobs'
import { PostgresModelCatalogRepository } from '@/server/ai/catalog'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres P1 production runtime foundations', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for P1 Postgres contracts',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const scope = `p1_${randomUUID().replaceAll('-', '')}`
  const userId = `${scope}_user`

  try {
    await t.test('schema compatibility metadata and migration lock are enforced', async () => {
      await assertAppDataSchemaCompatible(pool)
      const compatibility = await readAppDataSchemaCompatibility(pool)
      assert.equal(compatibility.compatible, true)
      assert.equal(compatibility.databaseSchemaVersion, APP_DATA_SCHEMA_VERSION)

      const first = await pool.connect()
      const second = await pool.connect()
      try {
        assert.equal(
          (await first.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [APP_DATA_MIGRATION_LOCK_ID])).rows[0]?.locked,
          true,
        )
        assert.equal(
          (await second.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [APP_DATA_MIGRATION_LOCK_ID])).rows[0]?.locked,
          false,
        )
      } finally {
        await first.query('SELECT pg_advisory_unlock($1)', [APP_DATA_MIGRATION_LOCK_ID])
        first.release()
        second.release()
      }
    })

    await db.insert(users).values({
      email: `${scope}@example.com`,
      emailVerified: true,
      id: userId,
      name: 'P1 Contract User',
    })
    await db.execute(sql`DELETE FROM durable_jobs`)
    await db.execute(sql`DELETE FROM outbox_events`)
    await db.execute(sql`DELETE FROM scheduled_tasks`)

    await t.test('workers leave unsupported release jobs queued for a compatible image', async () => {
      const repository = new PostgresDurableJobRepository(db)
      const unsupportedId = await repository.enqueue({
        dedupeKey: `${scope}:unsupported-release-job`,
        priority: 100,
        type: `${scope}.next-release`,
      })
      const supportedId = await repository.enqueue({
        dedupeKey: `${scope}:supported-release-job`,
        type: `${scope}.current-release`,
      })

      const claimed = await repository.claim({
        leaseMs: 5_000,
        supportedTypes: [`${scope}.current-release`],
        workerId: `${scope}:current-worker`,
      })
      assert.equal(claimed?.id, supportedId)
      assert.equal(await repository.complete({
        jobId: supportedId,
        workerId: `${scope}:current-worker`,
      }), true)
      const [unsupported] = await db
        .select({ attempts: durableJobs.attempts, status: durableJobs.status })
        .from(durableJobs)
        .where(eq(durableJobs.id, unsupportedId))
      assert.deepEqual(unsupported, { attempts: 0, status: 'queued' })
      await db.delete(durableJobs)
    })

    await t.test('idempotency reservation is atomic across repository instances', async () => {
      const first = new PostgresIdempotencyRepository(db)
      const second = new PostgresIdempotencyRepository(db)
      const args = {
        expiresAt: Date.now() + 60_000,
        keyHash: `${scope}_key`,
        method: 'POST',
        path: '/api/v1/conversations',
        requestHash: `${scope}_request`,
        userId,
      }
      const reservations = await Promise.all([first.reserve(args), second.reserve(args)])
      assert.deepEqual(reservations.map((result) => result.status).sort(), ['in_flight', 'reserved'])
      assert.equal(await first.complete({
        keyHash: args.keyHash,
        requestHash: args.requestHash,
        responseBody: '{"ok":true}',
        responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        responseStatus: 200,
      }), true)
      const replay = await second.reserve(args)
      assert.equal(replay.status, 'replay')
      assert.equal(replay.responseStatus, 200)
    })

    await t.test('service auth replay nonce is consumed once across instances', async () => {
      const first = new PostgresServiceAuthReplayRepository(db)
      const second = new PostgresServiceAuthReplayRepository(db)
      const payload = {
        aud: 'overlay-internal-api',
        exp: Date.now() + 60_000,
        iat: Date.now(),
        iss: 'overlay-nextjs',
        jti: `${scope}_jti`,
        method: 'POST',
        path: '/api/v1/test',
        sub: userId,
      }
      const consumed = await Promise.all([first.consume(payload), second.consume(payload)])
      assert.deepEqual(consumed.sort(), [false, true])
    })

    await t.test('jobs claim once, recover expired leases, retry, and dead-letter', async () => {
      const first = new PostgresDurableJobRepository(db)
      const second = new PostgresDurableJobRepository(db)
      const jobId = await first.enqueue({
        dedupeKey: `${scope}:job:dead-letter`,
        maxAttempts: 2,
        type: `${scope}.failure`,
      })
      const claims = await Promise.all([
        first.claim({ leaseMs: 5_000, workerId: `${scope}_worker_1` }),
        second.claim({ leaseMs: 5_000, workerId: `${scope}_worker_2` }),
      ])
      const claimed = claims.find(Boolean)
      assert.equal(claims.filter(Boolean).length, 1)
      assert.equal(claimed?.id, jobId)
      assert.equal(await first.fail({
        error: 'first failure',
        jobId,
        retryDelayMs: 0,
        workerId: claimed?.leaseOwner ?? '',
      }), 'retry')
      const secondClaim = await second.claim({ leaseMs: 5_000, workerId: `${scope}_worker_2` })
      assert.equal(secondClaim?.attempts, 2)
      assert.equal(await second.fail({
        error: 'second failure',
        jobId,
        retryDelayMs: 0,
        workerId: `${scope}_worker_2`,
      }), 'dead_letter')

      const leaseJob = await first.enqueue({
        availableAt: 10_000,
        dedupeKey: `${scope}:job:lease`,
        maxAttempts: 3,
        type: `${scope}.lease`,
      })
      const leaseClaim = await first.claim({
        leaseMs: 5_000,
        now: 10_000,
        workerId: `${scope}_crashed`,
      })
      assert.equal(leaseClaim?.id, leaseJob)
      assert.deepEqual(
        await second.recoverExpiredLeases({ now: 15_001 }),
        { deadLettered: 0, requeued: 1 },
      )
      assert.equal((await second.claim({
        leaseMs: 5_000,
        now: 15_001,
        workerId: `${scope}_recovery`,
      }))?.id, leaseJob)
    })

    await t.test('outbox claims once across publishers', async () => {
      const first = new PostgresOutboxRepository(db)
      const second = new PostgresOutboxRepository(db)
      const eventId = await first.append({
        dedupeKey: `${scope}:outbox`,
        payload: { scope },
        topic: `${scope}.event`,
      })
      const claims = await Promise.all([
        first.claim({ leaseMs: 5_000, workerId: `${scope}_publisher_1` }),
        second.claim({ leaseMs: 5_000, workerId: `${scope}_publisher_2` }),
      ])
      const claimed = claims.find(Boolean)
      const claimedIndex = claims.findIndex(Boolean)
      const claimingRepository = claimedIndex === 0 ? first : second
      const claimingWorker = claimedIndex === 0 ? `${scope}_publisher_1` : `${scope}_publisher_2`
      assert.equal(claims.filter(Boolean).length, 1)
      assert.equal(claimed?.id, eventId)
      assert.equal(await claimingRepository.renewLease({
        eventId,
        leaseMs: 10_000,
        workerId: claimingWorker,
      }), true)
      assert.equal(await claimingRepository.markPublished({
        eventId,
        workerId: claimingWorker,
      }), true)
    })

    await t.test('competing schedulers enqueue one job per due schedule', async () => {
      const first = new PostgresSchedulerService(db)
      const second = new PostgresSchedulerService(db)
      const now = Date.now()
      await first.registerDefaults(now)
      const ticks = await Promise.all([first.tick({ now }), second.tick({ now })])
      assert.equal(ticks.reduce((total, tick) => total + tick.enqueued, 0), POSTGRES_RUNTIME_SCHEDULES.length)
    })

    await t.test('model catalog snapshots survive repository replacement', async () => {
      const source = `https://catalog.example.com/${scope}`
      await new PostgresModelCatalogRepository(db).upsert({
        fetchedAt: Date.now() + 60_000,
        modelsJson: JSON.stringify([{ id: `${scope}/model`, name: 'P1 Model', type: 'language' }]),
        source,
      })
      const snapshot = await new PostgresModelCatalogRepository(db).getLatest()
      assert.equal(snapshot?.source, source)
      assert.equal(JSON.parse(snapshot?.modelsJson ?? '[]')[0]?.id, `${scope}/model`)
    })
  } finally {
    await db.execute(sql`DELETE FROM users WHERE id = ${userId}`)
    await db.execute(sql`
      DELETE FROM durable_jobs
      WHERE type LIKE ${`${scope}%`}
        OR dedupe_key LIKE ${`${scope}%`}
        OR dedupe_key LIKE 'schedule:%'
    `)
    await db.execute(sql`DELETE FROM outbox_events WHERE topic LIKE ${`${scope}%`} OR dedupe_key LIKE ${`${scope}%`}`)
    await db.execute(sql`DELETE FROM scheduled_tasks`)
    await db.execute(sql`DELETE FROM model_catalog_snapshots WHERE source LIKE ${`%${scope}%`}`)
    await pool.end()
  }
})
