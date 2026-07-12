import 'server-only'

import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { automationRuns, durableJobs, users } from '@/server/database/postgres/schema'
import { PostgresAccountDataDeletionRepository } from '@/server/account/PostgresAccountDataDeletionRepository'
import { PostgresActConversationRepository } from '@/server/conversations/PostgresActConversationRepository'
import { PostgresAutomationRepository } from '@/server/automations/PostgresAutomationRepository'
import { AUTOMATION_EXECUTE_JOB } from '@/server/automations/PostgresAutomationRunCoordinator'
import { PostgresWebhookRepository, WEBHOOK_DELIVERY_JOB } from '@/server/webhooks'
import { runAutomationWebhookContract } from './automation-webhook-contract'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('real Postgres automation and webhook provider contract', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    max: 4,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  try {
    await runAutomationWebhookContract(t, {
      automations: new PostgresAutomationRepository(db, new PostgresActConversationRepository(db)),
      cleanupUser: async (userId) => { await db.delete(users).where(eq(users.id, userId)) },
      prepareUser: async (userId) => {
        await db.insert(users).values({ email: `${userId}@example.test`, id: userId })
      },
      provider: 'postgres',
      webhooks: new PostgresWebhookRepository(db),
    })

    await t.test('Postgres account deletion removes P6 rows and queued work', async () => {
      const userId = `p6_delete_${randomUUID()}`
      await db.insert(users).values({ email: `${userId}@example.test`, id: userId })
      const automations = new PostgresAutomationRepository(db, new PostgresActConversationRepository(db))
      const webhooks = new PostgresWebhookRepository(db)
      const automationId = await automations.createAutomation({
        description: 'Deletion proof',
        enabled: false,
        instructions: 'Deletion proof',
        name: 'Deletion proof',
        schedule: { intervalMinutes: 30, kind: 'interval' },
        userId,
      })
      const failedRunId = await automations.createManualRun({
        automationId,
        scheduledFor: Date.now(),
        userId,
      })
      await automations.markManualRunFailed({
        error: 'Expected deletion proof failure',
        now: Date.now(),
        runId: failedRunId!,
        userId,
      })
      const retryRunId = await automations.retryRun({ runId: failedRunId!, userId })
      const subscription = await webhooks.create({
        events: ['automation.finished'],
        url: 'https://hooks.example.test/delete-proof',
        userId,
      })
      await webhooks.dispatch({
        event: {
          createdAt: Date.now(),
          data: {},
          id: `delete_event_${randomUUID()}`,
          type: 'automation.finished',
          userId,
        },
        userId,
      })
      const [retryRun] = await db
        .select({ jobId: automationRuns.jobId })
        .from(automationRuns)
        .where(eq(automationRuns.id, retryRunId!))
      const [delivery] = await webhooks.listDeliveries({ subscriptionId: subscription.id, userId })
      const ownedJobs = await db.execute<{ id: string }>(sql`
        SELECT id
        FROM durable_jobs
        WHERE id = ${retryRun?.jobId ?? ''}
          OR payload ->> 'deliveryId' = ${delivery?._id ?? ''}
      `)
      assert.equal(ownedJobs.rows.length, 2)

      const deletion = await new PostgresAccountDataDeletionRepository(db).deleteUserAccount({ userId })
      assert.equal(deletion.verification.orphanedRowCount, 0)
      assert.ok(deletion.deletedRowCount >= 5)
      const remainingJobIds = (await db
        .select({ id: durableJobs.id })
        .from(durableJobs)
        .where(inArray(durableJobs.id, ownedJobs.rows.map((row) => row.id)))).map((row) => row.id)
      assert.deepEqual(remainingJobIds, [])
      assert.equal((await webhooks.list({ userId })).length, 0)
      assert.equal((await automations.listAutomations({ userId, includeDeleted: true })).length, 0)
    })
  } finally {
    await db.delete(durableJobs).where(inArray(durableJobs.type, [
      AUTOMATION_EXECUTE_JOB,
      WEBHOOK_DELIVERY_JOB,
    ]))
    await pool.end()
  }
})
