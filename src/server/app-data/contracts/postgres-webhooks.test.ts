import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { asc, eq } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import {
  durableJobs,
  users,
  webhookDeliveries,
  webhookDeliveryAttempts,
} from '@/server/database/postgres/schema'
import { PostgresDurableJobRepository } from '@/server/jobs/PostgresDurableJobRepository'
import { PostgresJobWorker } from '@/server/jobs/PostgresJobWorker'
import {
  PostgresWebhookDeliveryService,
  PostgresWebhookRepository,
  WEBHOOK_DELIVERY_JOB,
  verifyWebhookSignature,
} from '@/server/webhooks'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test(
  'Postgres webhook subscriptions and durable signed delivery',
  { skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required' },
  async (t) => {
    if (!connectionString) return
    const pool = createOverlayPostgresPool({
      connectionString,
      max: 4,
      sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
    })
    const db = createOverlayPostgresDb(pool)
    const userId = `p6_webhook_${randomUUID()}`
    const foreignUserId = `p6_webhook_foreign_${randomUUID()}`
    const repository = new PostgresWebhookRepository(db)
    try {
      await db.delete(durableJobs).where(eq(durableJobs.type, WEBHOOK_DELIVERY_JOB))
      await db.insert(users).values([
        { email: `${userId}@example.test`, id: userId },
        { email: `${foreignUserId}@example.test`, id: foreignUserId },
      ])

      let subscriptionId = ''
      let subscriptionSecret = ''
      await t.test('management is user scoped and returns the secret only once', async () => {
        const created = await repository.create({
          description: 'P6 receiver',
          events: ['automation.finished'],
          url: 'https://hooks.example.test/overlay',
          userId,
        })
        subscriptionId = created.id
        subscriptionSecret = created.secret
        assert.equal(created.secret.length, 64)
        const listed = await repository.list({ userId })
        assert.equal(listed.length, 1)
        assert.equal(listed[0]?._id, subscriptionId)
        assert.equal('secret' in (listed[0] ?? {}), false)
        assert.equal(await repository.update({
          subscriptionId,
          enabled: false,
          userId: foreignUserId,
        }), false)
        assert.equal(await repository.remove({ subscriptionId, userId: foreignUserId }), false)
        assert.equal(await repository.rotateSecret({ subscriptionId, userId: foreignUserId }), null)
        const rotated = await repository.rotateSecret({ subscriptionId, userId })
        assert.ok(rotated)
        assert.notEqual(rotated, subscriptionSecret)
        subscriptionSecret = rotated
      })

      await t.test('event deduplication and HMAC headers survive worker execution', async () => {
        const event = {
          createdAt: Date.now(),
          data: { automationId: 'automation_1' },
          id: `event_${randomUUID()}`,
          type: 'automation.finished' as const,
          userId,
        }
        assert.deepEqual(await repository.dispatch({ event, userId }), { enqueued: 1 })
        assert.deepEqual(await repository.dispatch({ event, userId }), { enqueued: 0 })
        let delivered = false
        const delivery = new PostgresWebhookDeliveryService(db, {
          fetch: async (_url, init) => {
            assert.equal(init?.redirect, 'error')
            const headers = new Headers(init?.headers)
            const timestamp = Number(headers.get('X-Overlay-Timestamp'))
            assert.equal(headers.get('X-Overlay-Event-Id'), event.id)
            assert.equal(verifyWebhookSignature({
              payload: String(init?.body),
              secret: subscriptionSecret,
              signature: headers.get('X-Overlay-Signature') ?? '',
              timestamp,
            }), true)
            delivered = true
            return new Response(null, { status: 204 })
          },
          validateUrl: async () => {},
        })
        const worker = workerFor(db, delivery, `p6-webhook-success-${randomUUID()}`)
        assert.equal(await worker.runOnce(), 'succeeded')
        assert.equal(delivered, true)
        const [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.eventId, event.id))
        assert.equal(row?.status, 'delivered')
        assert.equal(row?.lastStatusCode, 204)
      })

      await t.test('failed endpoints are retried and dead-lettered with attempt audit', async () => {
        await repository.update({
          events: ['automation.failed'],
          subscriptionId,
          userId,
        })
        const event = {
          createdAt: Date.now(),
          data: { error: 'expected' },
          id: `event_${randomUUID()}`,
          type: 'automation.failed' as const,
          userId,
        }
        assert.equal((await repository.dispatch({ event, userId })).enqueued, 1)
        const delivery = new PostgresWebhookDeliveryService(db, {
          fetch: async () => new Response(null, { status: 503 }),
          validateUrl: async () => {},
        })
        const worker = workerFor(db, delivery, `p6-webhook-failure-${randomUUID()}`)
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          assert.equal(
            await worker.runOnce(Date.now() + attempt * 20 * 60_000),
            attempt === 5 ? 'dead_letter' : 'retry',
          )
        }
        const [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.eventId, event.id))
        assert.equal(row?.status, 'dead_letter')
        assert.equal(row?.attemptCount, 5)
        const attempts = await db
          .select()
          .from(webhookDeliveryAttempts)
          .where(eq(webhookDeliveryAttempts.deliveryId, row!.id))
          .orderBy(asc(webhookDeliveryAttempts.attemptNumber))
        assert.equal(attempts.length, 5)
        assert.ok(attempts.every((attempt) => attempt.status === 'failed'))
        const [job] = await db
          .select()
          .from(durableJobs)
          .where(eq(durableJobs.dedupeKey, `webhook-delivery:${row!.id}`))
        assert.equal(job?.status, 'dead_letter')

        const listed = await repository.listDeliveries({ subscriptionId, userId })
        const listedDeadLetter = listed.find((delivery) => delivery._id === row!.id)
        assert.equal(listedDeadLetter?.status, 'dead_letter')
        assert.equal(listedDeadLetter?.attempts.length, 5)
        assert.equal(await repository.redriveDelivery({ deliveryId: row!.id, userId: foreignUserId }), null)

        const redrivenId = await repository.redriveDelivery({ deliveryId: row!.id, userId })
        assert.ok(redrivenId)
        const recovery = new PostgresWebhookDeliveryService(db, {
          fetch: async () => new Response(null, { status: 204 }),
          validateUrl: async () => {},
        })
        assert.equal(
          await workerFor(db, recovery, `p6-webhook-redrive-${randomUUID()}`).runOnce(Date.now() + 3 * 60 * 60_000),
          'succeeded',
        )
        const redriven = (await repository.listDeliveries({ subscriptionId, userId }))
          .find((delivery) => delivery._id === redrivenId)
        assert.equal(redriven?.status, 'delivered')
      })
    } finally {
      await db.delete(users).where(eq(users.id, userId))
      await db.delete(users).where(eq(users.id, foreignUserId))
      await db.delete(durableJobs).where(eq(durableJobs.type, WEBHOOK_DELIVERY_JOB))
      await pool.end()
    }
  },
)

function workerFor(
  db: ReturnType<typeof createOverlayPostgresDb>,
  delivery: PostgresWebhookDeliveryService,
  workerId: string,
) {
  return new PostgresJobWorker({
    handlers: { [WEBHOOK_DELIVERY_JOB]: async (job) => await delivery.deliver(job) },
    leaseMs: 30_000,
    repository: new PostgresDurableJobRepository(db),
    workerId,
  })
}
