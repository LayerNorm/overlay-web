import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { durableJobs } from '@/server/database/postgres/schema'
import type { DurableJob, DurableJobRepository } from './DurableJobRepository'

type DurableJobRow = typeof durableJobs.$inferSelect

export class PostgresDurableJobRepository implements DurableJobRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async enqueue(args: {
    availableAt?: number
    dedupeKey?: string
    id?: string
    maxAttempts?: number
    payload?: Record<string, unknown>
    priority?: number
    type: string
  }): Promise<string> {
    const id = args.id ?? randomUUID()
    const inserted = await this.db
      .insert(durableJobs)
      .values({
        availableAt: new Date(args.availableAt ?? Date.now()),
        dedupeKey: args.dedupeKey,
        id,
        maxAttempts: normalizeMaxAttempts(args.maxAttempts),
        payload: args.payload ?? {},
        priority: normalizePriority(args.priority),
        type: requireValue(args.type, 'job type'),
      })
      .onConflictDoNothing()
      .returning({ id: durableJobs.id })
    if (inserted[0]) return inserted[0].id
    if (!args.dedupeKey) throw new Error(`Durable job ${id} already exists`)

    const [existing] = await this.db
      .select({ id: durableJobs.id })
      .from(durableJobs)
      .where(eq(durableJobs.dedupeKey, args.dedupeKey))
      .limit(1)
    if (!existing) throw new Error('Durable job dedupe conflict could not be resolved')
    return existing.id
  }

  async claim(args: {
    leaseMs: number
    now?: number
    supportedTypes?: readonly string[]
    workerId: string
  }): Promise<DurableJob | null> {
    const now = new Date(args.now ?? Date.now())
    const leaseExpiresAt = new Date(now.getTime() + normalizeLeaseMs(args.leaseMs))
    const workerId = requireValue(args.workerId, 'worker id')
    const supportedTypes = args.supportedTypes?.map((type) => requireValue(type, 'supported job type'))
    if (supportedTypes?.length === 0) return null
    const supportedTypeFilter = supportedTypes
      ? sql`AND type IN (${sql.join(supportedTypes.map((type) => sql`${type}`), sql`, `)})`
      : sql``
    const result = await this.db.execute<DurableJobRow>(sql`
      WITH candidate AS (
        SELECT id
        FROM durable_jobs
        WHERE status = 'queued'
          AND available_at <= ${now}
          ${supportedTypeFilter}
        ORDER BY priority DESC, available_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ), claimed AS (
        UPDATE durable_jobs job
        SET
          status = 'running',
          attempts = job.attempts + 1,
          lease_owner = ${workerId},
          lease_expires_at = ${leaseExpiresAt},
          started_at = COALESCE(job.started_at, ${now}),
          updated_at = ${now}
        FROM candidate
        WHERE job.id = candidate.id
        RETURNING job.*
      )
      SELECT
        id,
        type,
        payload,
        status,
        priority,
        attempts,
        max_attempts AS "maxAttempts",
        available_at AS "availableAt",
        dedupe_key AS "dedupeKey",
        lease_owner AS "leaseOwner",
        lease_expires_at AS "leaseExpiresAt",
        last_error AS "lastError",
        result,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        started_at AS "startedAt",
        completed_at AS "completedAt",
        dead_lettered_at AS "deadLetteredAt"
      FROM claimed
    `)
    return result.rows[0] ? normalizeJob(result.rows[0]) : null
  }

  async complete(args: { jobId: string; result?: unknown; workerId: string }): Promise<boolean> {
    const rows = await this.db
      .update(durableJobs)
      .set({
        completedAt: new Date(),
        leaseExpiresAt: null,
        leaseOwner: null,
        result: args.result,
        status: 'succeeded',
        updatedAt: new Date(),
      })
      .where(and(
        eq(durableJobs.id, args.jobId),
        eq(durableJobs.status, 'running'),
        eq(durableJobs.leaseOwner, args.workerId),
      ))
      .returning({ id: durableJobs.id })
    return rows.length > 0
  }

  async fail(args: {
    error: string
    jobId: string
    now?: number
    retryDelayMs: number
    workerId: string
  }): Promise<'retry' | 'dead_letter' | 'lost_lease'> {
    return await this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ attempts: number; max_attempts: number }>(sql`
        SELECT attempts, max_attempts
        FROM durable_jobs
        WHERE id = ${args.jobId}
          AND status = 'running'
          AND lease_owner = ${args.workerId}
        FOR UPDATE
      `)
      const current = rows.rows[0]
      if (!current) return 'lost_lease'

      const now = new Date(args.now ?? Date.now())
      const deadLetter = Number(current.attempts) >= Number(current.max_attempts)
      await tx
        .update(durableJobs)
        .set(deadLetter
          ? {
              deadLetteredAt: now,
              lastError: truncateError(args.error),
              leaseExpiresAt: null,
              leaseOwner: null,
              status: 'dead_letter',
              updatedAt: now,
            }
          : {
              availableAt: new Date(now.getTime() + Math.max(0, args.retryDelayMs)),
              lastError: truncateError(args.error),
              leaseExpiresAt: null,
              leaseOwner: null,
              status: 'queued',
              updatedAt: now,
            })
        .where(eq(durableJobs.id, args.jobId))
      return deadLetter ? 'dead_letter' : 'retry'
    })
  }

  async renewLease(args: {
    jobId: string
    leaseMs: number
    now?: number
    workerId: string
  }): Promise<boolean> {
    const now = new Date(args.now ?? Date.now())
    const rows = await this.db
      .update(durableJobs)
      .set({
        leaseExpiresAt: new Date(now.getTime() + normalizeLeaseMs(args.leaseMs)),
        updatedAt: now,
      })
      .where(and(
        eq(durableJobs.id, args.jobId),
        eq(durableJobs.status, 'running'),
        eq(durableJobs.leaseOwner, args.workerId),
      ))
      .returning({ id: durableJobs.id })
    return rows.length > 0
  }

  async recoverExpiredLeases(args: {
    limit?: number
    now?: number
  } = {}): Promise<{ deadLettered: number; requeued: number }> {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 1_000)
    const now = new Date(args.now ?? Date.now())
    const result = await this.db.execute<{ status: 'dead_letter' | 'queued' }>(sql`
      WITH candidates AS (
        SELECT id
        FROM durable_jobs
        WHERE status = 'running'
          AND lease_expires_at <= ${now}
        ORDER BY lease_expires_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      ), recovered AS (
        UPDATE durable_jobs job
        SET
          status = CASE
            WHEN job.attempts >= job.max_attempts THEN 'dead_letter'::overlay_durable_job_status
            ELSE 'queued'::overlay_durable_job_status
          END,
          available_at = ${now},
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error = COALESCE(job.last_error, 'Worker lease expired before completion'),
          dead_lettered_at = CASE
            WHEN job.attempts >= job.max_attempts THEN ${now}::timestamptz
            ELSE NULL::timestamptz
          END,
          updated_at = ${now}
        FROM candidates
        WHERE job.id = candidates.id
        RETURNING job.status
      )
      SELECT status FROM recovered
    `)
    return {
      deadLettered: result.rows.filter((row) => row.status === 'dead_letter').length,
      requeued: result.rows.filter((row) => row.status === 'queued').length,
    }
  }
}

function normalizeJob(row: DurableJobRow): DurableJob {
  return {
    attempts: row.attempts,
    availableAt: dateMillis(row.availableAt),
    ...(row.dedupeKey ? { dedupeKey: row.dedupeKey } : {}),
    id: row.id,
    ...(row.lastError ? { lastError: row.lastError } : {}),
    ...(row.leaseExpiresAt ? { leaseExpiresAt: dateMillis(row.leaseExpiresAt) } : {}),
    ...(row.leaseOwner ? { leaseOwner: row.leaseOwner } : {}),
    maxAttempts: row.maxAttempts,
    payload: row.payload,
    priority: row.priority,
    status: row.status,
    type: row.type,
  }
}

function normalizeLeaseMs(value: number): number {
  if (!Number.isFinite(value) || value < 1_000) throw new Error('Job lease must be at least 1000ms')
  return Math.min(value, 60 * 60_000)
}

function normalizeMaxAttempts(value = 5): number {
  return Number.isInteger(value) ? Math.min(Math.max(value, 1), 100) : 5
}

function normalizePriority(value = 0): number {
  return Number.isInteger(value) ? Math.min(Math.max(value, -100), 100) : 0
}

function requireValue(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function truncateError(value: string): string {
  return value.slice(0, 8_192)
}

function dateMillis(value: Date | string): number {
  const millis = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (!Number.isFinite(millis)) throw new Error('Durable job contained an invalid timestamp')
  return millis
}
