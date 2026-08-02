import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { ScheduledAutomationTurn } from '@/server/agent/run-act-turn'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import {
  automationRunAttempts,
  automationRuns,
  automations,
  automationTriggers,
  durableJobs,
} from '@/server/database/postgres/schema'
import { computeNextAutomationRunAt, normalizeAutomationSchedule } from './AutomationSchedule'
import type { AutomationSchedule } from './AutomationRepository'
import { durableJobAuthorization } from '@/server/jobs/DurableJobAuthorization'

export const AUTOMATION_SCHEDULE_DUE_JOB = 'automation.schedule-due'
export const AUTOMATION_EXECUTE_JOB = 'automation.execute'

type DueAutomation = {
  automationId: string
  concurrencyPolicy: 'queue' | 'skip'
  nextFireAt: Date | string
  schedule: Record<string, unknown>
  triggerId: string
  userId: string
}

export class PostgresAutomationRunCoordinator {
  constructor(private readonly db: OverlayPostgresDb) {}

  async enqueueDueRuns(args: { limit?: number; now?: number } = {}): Promise<{
    enqueued: number
    skipped: number
  }> {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 1_000)
    const now = new Date(args.now ?? Date.now())
    return await this.db.transaction(async (tx) => {
      const due = await tx.execute<DueAutomation>(sql`
        SELECT
          automation.id AS "automationId",
          automation.user_id AS "userId",
          automation.schedule,
          automation.concurrency_policy AS "concurrencyPolicy",
          trigger.id AS "triggerId",
          trigger.next_fire_at AS "nextFireAt"
        FROM automation_triggers trigger
        INNER JOIN automations automation ON automation.id = trigger.automation_id
        WHERE trigger.kind = 'schedule'
          AND trigger.enabled = true
          AND trigger.next_fire_at <= ${now}
          AND automation.enabled = true
          AND automation.deleted_at IS NULL
        ORDER BY trigger.next_fire_at ASC
        FOR UPDATE OF trigger, automation SKIP LOCKED
        LIMIT ${limit}
      `)
      let enqueued = 0
      let skipped = 0
      for (const item of due.rows) {
        const scheduledFor = dateValue(item.nextFireAt)
        const idempotencyKey = `schedule:${item.automationId}:${scheduledFor.getTime()}`
        const nextRunAt = new Date(computeNextAutomationRunAt(
          normalizeAutomationSchedule(item.schedule as AutomationSchedule),
          Math.max(now.getTime(), scheduledFor.getTime()),
        ))
        const [active] = item.concurrencyPolicy === 'skip'
          ? await tx
              .select({ id: automationRuns.id })
              .from(automationRuns)
              .where(and(
                eq(automationRuns.automationId, item.automationId),
                inArray(automationRuns.status, ['queued', 'running', 'cancel_requested']),
              ))
              .limit(1)
          : []
        const runId = `automation_run_${randomUUID()}`
        if (active) {
          const inserted = await tx
            .insert(automationRuns)
            .values({
              automationId: item.automationId,
              completedAt: now,
              error: 'Skipped because another run is active',
              id: runId,
              idempotencyKey,
              scheduledFor,
              status: 'skipped',
              triggerId: item.triggerId,
              triggerSource: 'schedule',
              userId: item.userId,
            })
            .onConflictDoNothing()
            .returning({ id: automationRuns.id })
          skipped += inserted.length
        } else {
          const jobId = randomUUID()
          const inserted = await tx
            .insert(automationRuns)
            .values({
              automationId: item.automationId,
              id: runId,
              idempotencyKey,
              jobId,
              scheduledFor,
              status: 'queued',
              triggerId: item.triggerId,
              triggerSource: 'schedule',
              userId: item.userId,
            })
            .onConflictDoNothing()
            .returning({ id: automationRuns.id })
          if (inserted.length > 0) {
            await tx.insert(durableJobs).values({
              dedupeKey: `automation-run:${runId}`,
              id: jobId,
              maxAttempts: 5,
              payload: {
                runId,
                ...durableJobAuthorization(item.userId, ['automations.use', 'models.use']),
              },
              priority: 10,
              type: AUTOMATION_EXECUTE_JOB,
            })
            enqueued += 1
          }
        }
        await tx
          .update(automationTriggers)
          .set({ lastFiredAt: now, nextFireAt: nextRunAt, updatedAt: now })
          .where(eq(automationTriggers.id, item.triggerId))
        await tx
          .update(automations)
          .set({ nextRunAt, updatedAt: now })
          .where(eq(automations.id, item.automationId))
      }
      return { enqueued, skipped }
    })
  }

  async getExecutionInput(runId: string): Promise<ScheduledAutomationTurn | null> {
    const result = await this.db.execute<{
      automationId: string
      conversationId: string | null
      description: string
      instructions: string
      modelId: string | null
      name: string
      projectId: string | null
      runConversationId: string | null
      scheduledFor: Date | string
      sourceConversationId: string | null
      turnId: string | null
      userId: string
    }>(sql`
      SELECT
        automation.id AS "automationId",
        automation.user_id AS "userId",
        automation.name,
        automation.description,
        automation.instructions,
        automation.project_id AS "projectId",
        automation.model_id AS "modelId",
        automation.source_conversation_id AS "sourceConversationId",
        automation.conversation_id AS "conversationId",
        run.conversation_id AS "runConversationId",
        run.turn_id AS "turnId",
        run.scheduled_for AS "scheduledFor"
      FROM automation_runs run
      INNER JOIN automations automation ON automation.id = run.automation_id
      WHERE run.id = ${runId}
        AND run.status = 'running'
        AND automation.deleted_at IS NULL
      LIMIT 1
    `)
    const row = result.rows[0]
    if (!row) return null
    return {
      automationId: row.automationId,
      conversationId: row.runConversationId ?? row.sourceConversationId ?? row.conversationId ?? undefined,
      description: row.description,
      instructions: row.instructions,
      modelId: row.modelId ?? undefined,
      name: row.name,
      projectId: row.projectId ?? undefined,
      runId,
      scheduledFor: dateValue(row.scheduledFor).getTime(),
      turnId: row.turnId ?? `automation-${runId}-${Date.now()}`,
      userId: row.userId,
    }
  }

  async startAttempt(args: {
    attemptNumber: number
    jobId: string
    now?: number
    runId: string
    workerId: string
  }): Promise<'cancelled' | 'started' | 'terminal'> {
    const now = new Date(args.now ?? Date.now())
    return await this.db.transaction(async (tx) => {
      const rows = await tx.execute<{
        cancellation_requested_at: Date | string | null
        status: string
      }>(sql`
        SELECT status, cancellation_requested_at
        FROM automation_runs
        WHERE id = ${args.runId}
        FOR UPDATE
      `)
      const run = rows.rows[0]
      if (!run || ['succeeded', 'completed', 'failed', 'cancelled', 'skipped', 'dead_letter'].includes(run.status)) {
        return 'terminal'
      }
      if (run.cancellation_requested_at || run.status === 'cancel_requested') {
        await tx
          .update(automationRuns)
          .set({ completedAt: now, status: 'cancelled', updatedAt: now })
          .where(eq(automationRuns.id, args.runId))
        return 'cancelled'
      }
      await tx
        .update(automationRuns)
        .set({
          attemptCount: args.attemptNumber,
          jobId: args.jobId,
          startedAt: now,
          status: 'running',
          updatedAt: now,
        })
        .where(eq(automationRuns.id, args.runId))
      await tx
        .insert(automationRunAttempts)
        .values({
          attemptNumber: args.attemptNumber,
          id: `automation_attempt_${randomUUID()}`,
          jobId: args.jobId,
          runId: args.runId,
          startedAt: now,
          status: 'running',
          workerId: args.workerId,
        })
        .onConflictDoUpdate({
          target: [automationRunAttempts.runId, automationRunAttempts.attemptNumber],
          set: { jobId: args.jobId, startedAt: now, status: 'running', workerId: args.workerId },
        })
      return 'started'
    })
  }

  async completeAttempt(args: {
    attemptNumber: number
    conversationId: string
    now?: number
    result?: Record<string, unknown>
    runId: string
  }): Promise<'cancelled' | 'succeeded' | 'terminal'> {
    const now = new Date(args.now ?? Date.now())
    return await this.db.transaction(async (tx) => {
      const rows = await tx.execute<{
        automation_id: string
        cancellation_requested_at: Date | string | null
        status: string
      }>(sql`
        SELECT automation_id, cancellation_requested_at, status
        FROM automation_runs
        WHERE id = ${args.runId}
        FOR UPDATE
      `)
      const current = rows.rows[0]
      if (!current || ['succeeded', 'completed', 'failed', 'cancelled', 'skipped', 'dead_letter'].includes(current.status)) {
        return 'terminal'
      }
      if (current.cancellation_requested_at || current.status === 'cancel_requested') {
        await tx
          .update(automationRuns)
          .set({
            completedAt: now,
            error: 'Cancelled while execution was in progress',
            status: 'cancelled',
            updatedAt: now,
          })
          .where(eq(automationRuns.id, args.runId))
        await tx
          .update(automationRunAttempts)
          .set({
            completedAt: now,
            error: 'Result discarded because cancellation was requested',
            status: 'cancelled',
          })
          .where(and(
            eq(automationRunAttempts.runId, args.runId),
            eq(automationRunAttempts.attemptNumber, args.attemptNumber),
          ))
        await tx
          .update(automations)
          .set({
            lastError: null,
            lastRunAt: now,
            lastRunStatus: 'cancelled',
            updatedAt: now,
          })
          .where(eq(automations.id, current.automation_id))
        return 'cancelled'
      }
      await tx
        .update(automationRuns)
        .set({
          completedAt: now,
          conversationId: args.conversationId,
          error: null,
          result: args.result ?? { conversationId: args.conversationId },
          status: 'succeeded',
          updatedAt: now,
        })
        .where(eq(automationRuns.id, args.runId))
      await tx
        .update(automationRunAttempts)
        .set({ completedAt: now, result: args.result, status: 'succeeded' })
        .where(and(
          eq(automationRunAttempts.runId, args.runId),
          eq(automationRunAttempts.attemptNumber, args.attemptNumber),
        ))
      await tx
        .update(automations)
        .set({
          conversationId: args.conversationId,
          lastError: null,
          lastRunAt: now,
          lastRunStatus: 'succeeded',
          updatedAt: now,
        })
        .where(eq(automations.id, current.automation_id))
      return 'succeeded'
    })
  }

  async failAttempt(args: {
    attemptNumber: number
    error: string
    now?: number
    runId: string
    terminal: boolean
  }): Promise<'cancelled' | 'failed' | 'terminal'> {
    const now = new Date(args.now ?? Date.now())
    const error = args.error.slice(0, 4_000)
    return await this.db.transaction(async (tx) => {
      const rows = await tx.execute<{
        automation_id: string
        cancellation_requested_at: Date | string | null
        status: string
      }>(sql`
        SELECT automation_id, cancellation_requested_at, status
        FROM automation_runs
        WHERE id = ${args.runId}
        FOR UPDATE
      `)
      const current = rows.rows[0]
      if (!current || ['succeeded', 'completed', 'failed', 'cancelled', 'skipped', 'dead_letter'].includes(current.status)) {
        return 'terminal'
      }
      const cancelled = Boolean(
        current.cancellation_requested_at || current.status === 'cancel_requested',
      )
      await tx
        .update(automationRuns)
        .set({
          ...(args.terminal || cancelled ? { completedAt: now } : {}),
          error: cancelled ? 'Cancelled while execution was in progress' : error,
          status: cancelled ? 'cancelled' : args.terminal ? 'dead_letter' : 'queued',
          updatedAt: now,
        })
        .where(eq(automationRuns.id, args.runId))
      await tx
        .update(automationRunAttempts)
        .set({
          completedAt: now,
          error: cancelled ? 'Execution stopped after cancellation was requested' : error,
          status: cancelled ? 'cancelled' : 'failed',
        })
        .where(and(
          eq(automationRunAttempts.runId, args.runId),
          eq(automationRunAttempts.attemptNumber, args.attemptNumber),
        ))
      await tx
        .update(automations)
        .set({
          lastError: cancelled ? null : error,
          lastRunAt: now,
          lastRunStatus: cancelled ? 'cancelled' : args.terminal ? 'dead_letter' : 'failed',
          updatedAt: now,
        })
        .where(eq(automations.id, current.automation_id))
      return cancelled ? 'cancelled' : 'failed'
    })
  }

  async requestCancellation(args: { runId: string; userId: string }): Promise<boolean> {
    const now = new Date()
    const rows = await this.db
      .update(automationRuns)
      .set({ cancellationRequestedAt: now, status: 'cancel_requested', updatedAt: now })
      .where(and(
        eq(automationRuns.id, args.runId),
        eq(automationRuns.userId, args.userId),
        inArray(automationRuns.status, ['queued', 'running']),
      ))
      .returning({ id: automationRuns.id })
    return rows.length > 0
  }

  async denyRunForAuthorization(args: { error: string; runId: string }): Promise<void> {
    const now = new Date()
    const error = args.error.slice(0, 4_000)
    const [run] = await this.db
      .update(automationRuns)
      .set({ completedAt: now, error, status: 'cancelled', updatedAt: now })
      .where(and(
        eq(automationRuns.id, args.runId),
        inArray(automationRuns.status, ['queued', 'running', 'cancel_requested']),
      ))
      .returning({ automationId: automationRuns.automationId })
    if (run) {
      await this.db.update(automations).set({
        lastError: error,
        lastRunAt: now,
        lastRunStatus: 'cancelled',
        updatedAt: now,
      }).where(eq(automations.id, run.automationId))
    }
  }
}

function dateValue(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Automation trigger contained an invalid timestamp')
  return date
}
