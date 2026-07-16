import 'server-only'

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import type { OverlayRuntimeConfig } from '@/shared/config'

export const POSTGRES_RUNTIME_SCHEDULES = [
  {
    id: 'app-data-maintenance',
    intervalMs: 60_000,
    jobType: 'app-data.maintenance',
    payload: {},
  },
  {
    id: 'model-catalog-refresh',
    intervalMs: 15 * 60_000,
    jobType: 'model-catalog.refresh',
    payload: {},
  },
  {
    id: 'coordination-cleanup',
    intervalMs: 60 * 60_000,
    jobType: 'coordination.cleanup',
    payload: {},
  },
  {
    id: 'storage-reconciliation',
    intervalMs: 24 * 60 * 60_000,
    jobType: 'storage.reconcile',
    payload: {},
  },
  {
    id: 'output-retention',
    intervalMs: 60 * 60_000,
    jobType: 'outputs.purge-expired',
    payload: {},
  },
  {
    id: 'knowledge-maintenance',
    intervalMs: 60 * 60_000,
    jobType: 'knowledge.maintenance',
    payload: {},
  },
  {
    id: 'automation-schedule-due',
    intervalMs: 60_000,
    jobType: 'automation.schedule-due',
    payload: {},
  },
  {
    id: 'daytona-reconciliation',
    intervalMs: 5 * 60_000,
    jobType: 'daytona.reconcile',
    payload: {},
  },
  {
    id: 'usage-reservation-reconciliation',
    intervalMs: 5 * 60_000,
    jobType: 'usage.reconcile',
    payload: {},
  },
] as const

type RuntimeSchedule = (typeof POSTGRES_RUNTIME_SCHEDULES)[number]

export function postgresRuntimeSchedulesForConfig(
  config: OverlayRuntimeConfig,
): readonly RuntimeSchedule[] {
  return POSTGRES_RUNTIME_SCHEDULES.filter((schedule) => {
    switch (schedule.id) {
      case 'storage-reconciliation':
        return config.features.files === true &&
          config.providers.objectStorage?.provider !== 'none' &&
          config.providers.objectStorage?.provider !== undefined
      case 'knowledge-maintenance':
        return isPostgresKnowledgeRuntimeEnabled(config)
      case 'automation-schedule-due':
        return config.features.automations === true
      case 'daytona-reconciliation':
        return config.features.sandboxes === true && config.providers.sandbox?.provider === 'daytona'
      default:
        return true
    }
  })
}

export function isPostgresKnowledgeRuntimeEnabled(config: OverlayRuntimeConfig): boolean {
  const embeddingsProvider = config.providers.embeddings?.provider
  return config.features.knowledge === true &&
    config.features.vectorSearch === true &&
    config.providers.vectorSearch?.provider === 'pgvector' &&
    embeddingsProvider !== 'none' &&
    embeddingsProvider !== undefined
}

type DueTask = {
  id: string
  intervalMs: number
  jobType: string
  nextRunAt: Date | string
  payload: Record<string, unknown>
}

export class PostgresSchedulerService {
  constructor(
    private readonly db: OverlayPostgresDb,
    private readonly schedules: readonly RuntimeSchedule[] = POSTGRES_RUNTIME_SCHEDULES,
  ) {}

  async registerDefaults(now = Date.now()): Promise<void> {
    const enabledIds = new Set(this.schedules.map((schedule) => schedule.id))
    for (const schedule of POSTGRES_RUNTIME_SCHEDULES) {
      if (!enabledIds.has(schedule.id)) {
        await this.db.execute(sql`
          UPDATE scheduled_tasks
          SET enabled = false, updated_at = ${new Date(now)}
          WHERE id = ${schedule.id}
        `)
        continue
      }
      await this.db.execute(sql`
        INSERT INTO scheduled_tasks (
          id, job_type, payload, interval_ms, next_run_at, enabled, created_at, updated_at
        ) VALUES (
          ${schedule.id},
          ${schedule.jobType},
          ${JSON.stringify(schedule.payload)}::jsonb,
          ${schedule.intervalMs},
          ${new Date(now)},
          true,
          ${new Date(now)},
          ${new Date(now)}
        )
        ON CONFLICT (id) DO UPDATE
        SET
          job_type = EXCLUDED.job_type,
          payload = EXCLUDED.payload,
          interval_ms = EXCLUDED.interval_ms,
          updated_at = EXCLUDED.updated_at
      `)
    }
  }

  async tick(args: { limit?: number; now?: number } = {}): Promise<{ enqueued: number }> {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 1_000)
    const now = new Date(args.now ?? Date.now())
    return await this.db.transaction(async (tx) => {
      const due = await tx.execute<DueTask>(sql`
        SELECT
          id,
          job_type AS "jobType",
          payload,
          interval_ms AS "intervalMs",
          next_run_at AS "nextRunAt"
        FROM scheduled_tasks
        WHERE enabled = true AND next_run_at <= ${now}
        ORDER BY next_run_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `)
      let enqueued = 0
      for (const task of due.rows) {
        const previousRunAt = dateValue(task.nextRunAt)
        const dedupeKey = `schedule:${task.id}:${previousRunAt.getTime()}`
        const inserted = await tx.execute<{ id: string }>(sql`
          INSERT INTO durable_jobs (
            id, type, payload, status, priority, attempts, max_attempts,
            available_at, dedupe_key, created_at, updated_at
          ) VALUES (
            ${randomUUID()},
            ${task.jobType},
            ${JSON.stringify(task.payload)}::jsonb,
            'queued',
            0,
            0,
            5,
            ${now},
            ${dedupeKey},
            ${now},
            ${now}
          )
          ON CONFLICT (dedupe_key) DO NOTHING
          RETURNING id
        `)
        enqueued += inserted.rows.length
        await tx.execute(sql`
          UPDATE scheduled_tasks
          SET
            next_run_at = ${nextRunAt(previousRunAt, task.intervalMs, now)},
            last_enqueued_at = ${now},
            updated_at = ${now}
          WHERE id = ${task.id}
        `)
      }
      return { enqueued }
    })
  }
}

function nextRunAt(previous: Date, intervalMs: number, now: Date): Date {
  const normalizedInterval = Math.min(Math.max(intervalMs, 1_000), 30 * 24 * 60 * 60_000)
  const elapsedIntervals = Math.max(
    1,
    Math.floor((now.getTime() - previous.getTime()) / normalizedInterval) + 1,
  )
  return new Date(previous.getTime() + elapsedIntervals * normalizedInterval)
}

function dateValue(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Scheduled task contained an invalid timestamp')
  return date
}
