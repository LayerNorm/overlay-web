import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { asc, eq, inArray } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import {
  automationRunAttempts,
  automationRuns,
  automations,
  automationTriggers,
  conversations,
  durableJobs,
  users,
} from '@/server/database/postgres/schema'
import { PostgresActConversationRepository } from '@/server/conversations/PostgresActConversationRepository'
import { PostgresAutomationRepository } from '@/server/automations/PostgresAutomationRepository'
import {
  AUTOMATION_EXECUTE_JOB,
  AUTOMATION_SCHEDULE_DUE_JOB,
} from '@/server/automations/PostgresAutomationRunCoordinator'
import { createPostgresRuntime } from '@/server/jobs/postgres-runtime'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test(
  'Postgres automation scheduler and durable worker lifecycle',
  { skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required' },
  async (t) => {
    if (!connectionString) return
    const pool = createOverlayPostgresPool({
      connectionString,
      max: 4,
      sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
    })
    const db = createOverlayPostgresDb(pool)
    const userId = `p6_runtime_${randomUUID()}`
    const conversationId = `p6_runtime_conversation_${randomUUID()}`
    const repository = new PostgresAutomationRepository(db, new PostgresActConversationRepository(db))
    const executions: string[] = []
    let shouldFail = false
    let blockedExecution: {
      markStarted: () => void
      release: Promise<void>
    } | null = null
    const runtime = createPostgresRuntime({
      automationExecutor: async (input) => {
        executions.push(input.runId)
        if (blockedExecution) {
          const gate = blockedExecution
          gate.markStarted()
          await gate.release
        }
        if (shouldFail) throw new Error('expected automation failure')
        return { conversationId }
      },
      db,
      leaseMs: 30_000,
      workerId: `p6-worker-${randomUUID()}`,
    })

    try {
      await db.delete(durableJobs).where(inArray(durableJobs.type, [
        AUTOMATION_EXECUTE_JOB,
        AUTOMATION_SCHEDULE_DUE_JOB,
      ]))
      await db.insert(users).values({ email: `${userId}@example.test`, id: userId })
      await db.insert(conversations).values({
        actModelId: 'openai/gpt-4.1',
        askModelIds: ['openai/gpt-4.1'],
        id: conversationId,
        lastMode: 'act',
        lastModified: new Date(),
        title: 'P6 runtime output',
        userId,
      })

      await t.test('one due occurrence enqueues and succeeds exactly once', async () => {
        const automationId = await createDueAutomation(repository, db, userId, 'Successful run')
        await runtime.jobs.enqueue({
          dedupeKey: `p6-schedule-${automationId}`,
          priority: 100,
          type: AUTOMATION_SCHEDULE_DUE_JOB,
        })
        assert.equal(await runtime.worker.runOnce(), 'succeeded')
        assert.equal(await runtime.worker.runOnce(), 'succeeded')

        const runs = await db.select().from(automationRuns).where(eq(automationRuns.automationId, automationId))
        assert.equal(runs.length, 1)
        assert.equal(runs[0]?.status, 'succeeded')
        assert.equal(runs[0]?.attemptCount, 1)
        assert.equal(executions.filter((id) => id === runs[0]?.id).length, 1)
        const attempts = await db
          .select()
          .from(automationRunAttempts)
          .where(eq(automationRunAttempts.runId, runs[0]!.id))
        assert.deepEqual(attempts.map((attempt) => attempt.status), ['succeeded'])

        const duplicate = await runtime.automationRuns.enqueueDueRuns()
        assert.deepEqual(duplicate, { enqueued: 0, skipped: 0 })
      })

      await t.test('failure is audited, retried, and eventually dead-lettered', async () => {
        shouldFail = true
        const automationId = await createDueAutomation(repository, db, userId, 'Failing run')
        assert.equal((await runtime.automationRuns.enqueueDueRuns()).enqueued, 1)
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          const result = await runtime.worker.runOnce(Date.now() + attempt * 20 * 60_000)
          assert.equal(result, attempt === 5 ? 'dead_letter' : 'retry')
        }
        const [run] = await db.select().from(automationRuns).where(eq(automationRuns.automationId, automationId))
        assert.equal(run?.status, 'dead_letter')
        assert.equal(run?.attemptCount, 5)
        const attempts = await db
          .select()
          .from(automationRunAttempts)
          .where(eq(automationRunAttempts.runId, run!.id))
          .orderBy(asc(automationRunAttempts.attemptNumber))
        assert.equal(attempts.length, 5)
        assert.ok(attempts.every((attempt) => attempt.status === 'failed'))
        const [job] = await db.select().from(durableJobs).where(eq(durableJobs.id, run!.jobId!))
        assert.equal(job?.status, 'dead_letter')
        shouldFail = false
        const retryRunId = await repository.retryRun({ runId: run!.id, userId })
        assert.ok(retryRunId)
        assert.equal(await runtime.worker.runOnce(Date.now() + 2 * 60 * 60_000), 'succeeded')
        const [retried] = await db.select().from(automationRuns).where(eq(automationRuns.id, retryRunId!))
        assert.equal(retried?.status, 'succeeded')
      })

      await t.test('queued cancellation prevents execution', async () => {
        const automationId = await createDueAutomation(repository, db, userId, 'Cancelled run')
        assert.equal((await runtime.automationRuns.enqueueDueRuns()).enqueued, 1)
        const [run] = await db.select().from(automationRuns).where(eq(automationRuns.automationId, automationId))
        assert.equal(await repository.requestRunCancellation({ runId: run!.id, userId }), true)
        const executionCount = executions.length
        assert.equal(await runtime.worker.runOnce(Date.now() + 60_000), 'succeeded')
        const [cancelled] = await db.select().from(automationRuns).where(eq(automationRuns.id, run!.id))
        assert.equal(cancelled?.status, 'cancelled')
        assert.equal(executions.length, executionCount)
      })

      await t.test('cancellation during execution cannot be overwritten by a late result', async () => {
        const automationId = await createDueAutomation(repository, db, userId, 'In-flight cancellation')
        assert.equal((await runtime.automationRuns.enqueueDueRuns()).enqueued, 1)
        const [run] = await db.select().from(automationRuns)
          .where(eq(automationRuns.automationId, automationId))
        let markStarted!: () => void
        let release!: () => void
        const started = new Promise<void>((resolve) => { markStarted = resolve })
        const releasePromise = new Promise<void>((resolve) => { release = resolve })
        blockedExecution = { markStarted, release: releasePromise }

        const workerResult = runtime.worker.runOnce(Date.now() + 60_000)
        await started
        assert.equal(await repository.requestActiveRunCancellation({ automationId, userId }), 1)
        release()
        assert.equal(await workerResult, 'succeeded')
        blockedExecution = null

        const [cancelled] = await db.select().from(automationRuns)
          .where(eq(automationRuns.id, run!.id))
        const [attempt] = await db.select().from(automationRunAttempts)
          .where(eq(automationRunAttempts.runId, run!.id))
        const [automation] = await db.select().from(automations)
          .where(eq(automations.id, automationId))
        assert.equal(cancelled?.status, 'cancelled')
        assert.equal(cancelled?.conversationId, null)
        assert.equal(attempt?.status, 'cancelled')
        assert.equal(automation?.lastRunStatus, 'cancelled')
      })

      await t.test('skip concurrency policy records an overlapping occurrence without a second job', async () => {
        const automationId = await createDueAutomation(repository, db, userId, 'Skip overlap', 'skip')
        assert.deepEqual(await runtime.automationRuns.enqueueDueRuns(), { enqueued: 1, skipped: 0 })
        const [active] = await db
          .select()
          .from(automationRuns)
          .where(eq(automationRuns.automationId, automationId))
        const dueAt = new Date(Date.now() - 1_000)
        await db
          .update(automationTriggers)
          .set({ nextFireAt: dueAt })
          .where(eq(automationTriggers.automationId, automationId))
        assert.deepEqual(await runtime.automationRuns.enqueueDueRuns(), { enqueued: 0, skipped: 1 })
        const runs = await db
          .select()
          .from(automationRuns)
          .where(eq(automationRuns.automationId, automationId))
        assert.deepEqual(runs.map((run) => run.status).sort(), ['queued', 'skipped'])
        assert.equal(await repository.requestRunCancellation({ runId: active!.id, userId }), true)
        assert.equal(await runtime.worker.runOnce(Date.now() + 60_000), 'succeeded')
      })
    } finally {
      await db.delete(users).where(eq(users.id, userId))
      await db.delete(durableJobs).where(inArray(durableJobs.type, [
        AUTOMATION_EXECUTE_JOB,
        AUTOMATION_SCHEDULE_DUE_JOB,
      ]))
      await pool.end()
    }
  },
)

async function createDueAutomation(
  repository: PostgresAutomationRepository,
  db: ReturnType<typeof createOverlayPostgresDb>,
  userId: string,
  name: string,
  concurrencyPolicy: 'queue' | 'skip' = 'queue',
): Promise<string> {
  const automationId = await repository.createAutomation({
    concurrencyPolicy,
    description: `${name} description`,
    instructions: `Execute ${name}`,
    name,
    schedule: { kind: 'interval', intervalMinutes: 15 },
    userId,
  })
  const dueAt = new Date(Date.now() - 1_000)
  await db.update(automations).set({ nextRunAt: dueAt }).where(eq(automations.id, automationId))
  await db
    .update(automationTriggers)
    .set({ nextFireAt: dueAt })
    .where(eq(automationTriggers.automationId, automationId))
  return automationId
}
