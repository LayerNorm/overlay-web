import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { outboxEvents } from '@/server/database/postgres/schema'
import type { OutboxEvent, OutboxRepository } from './OutboxRepository'

type ClaimedOutboxRow = {
  attempts: number
  id: string
  maxAttempts: number
  payload: Record<string, unknown>
  topic: string
}

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async append(args: {
    availableAt?: number
    dedupeKey?: string
    id?: string
    maxAttempts?: number
    payload?: Record<string, unknown>
    topic: string
  }): Promise<string> {
    const id = args.id ?? randomUUID()
    const inserted = await this.db
      .insert(outboxEvents)
      .values({
        availableAt: new Date(args.availableAt ?? Date.now()),
        dedupeKey: args.dedupeKey,
        id,
        maxAttempts: normalizeMaxAttempts(args.maxAttempts),
        payload: args.payload ?? {},
        topic: requireValue(args.topic, 'outbox topic'),
      })
      .onConflictDoNothing()
      .returning({ id: outboxEvents.id })
    if (inserted[0]) return inserted[0].id
    if (!args.dedupeKey) throw new Error(`Outbox event ${id} already exists`)
    const [existing] = await this.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, args.dedupeKey))
      .limit(1)
    if (!existing) throw new Error('Outbox dedupe conflict could not be resolved')
    return existing.id
  }

  async claim(args: { leaseMs: number; now?: number; workerId: string }): Promise<OutboxEvent | null> {
    const now = new Date(args.now ?? Date.now())
    const leaseMs = normalizeLeaseMs(args.leaseMs)
    const workerId = requireValue(args.workerId, 'worker id')
    const result = await this.db.execute<ClaimedOutboxRow>(sql`
      WITH candidate AS (
        SELECT id
        FROM outbox_events
        WHERE status = 'pending' AND available_at <= ${now}
        ORDER BY available_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ), claimed AS (
        UPDATE outbox_events event
        SET
          status = 'publishing',
          attempts = event.attempts + 1,
          lease_owner = ${workerId},
          lease_expires_at = ${new Date(now.getTime() + leaseMs)},
          updated_at = ${now}
        FROM candidate
        WHERE event.id = candidate.id
        RETURNING event.*
      )
      SELECT
        id,
        topic,
        payload,
        attempts,
        max_attempts AS "maxAttempts"
      FROM claimed
    `)
    return result.rows[0] ?? null
  }

  async markPublished(args: { eventId: string; workerId: string }): Promise<boolean> {
    const now = new Date()
    const rows = await this.db
      .update(outboxEvents)
      .set({
        leaseExpiresAt: null,
        leaseOwner: null,
        publishedAt: now,
        status: 'published',
        updatedAt: now,
      })
      .where(and(
        eq(outboxEvents.id, args.eventId),
        eq(outboxEvents.status, 'publishing'),
        eq(outboxEvents.leaseOwner, args.workerId),
      ))
      .returning({ id: outboxEvents.id })
    return rows.length > 0
  }

  async markFailed(args: {
    error: string
    eventId: string
    now?: number
    retryDelayMs: number
    workerId: string
  }): Promise<'retry' | 'dead_letter' | 'lost_lease'> {
    return await this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ attempts: number; max_attempts: number }>(sql`
        SELECT attempts, max_attempts
        FROM outbox_events
        WHERE id = ${args.eventId}
          AND status = 'publishing'
          AND lease_owner = ${args.workerId}
        FOR UPDATE
      `)
      const current = rows.rows[0]
      if (!current) return 'lost_lease'
      const now = new Date(args.now ?? Date.now())
      const deadLetter = Number(current.attempts) >= Number(current.max_attempts)
      await tx
        .update(outboxEvents)
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
              status: 'pending',
              updatedAt: now,
            })
        .where(eq(outboxEvents.id, args.eventId))
      return deadLetter ? 'dead_letter' : 'retry'
    })
  }

  async renewLease(args: {
    eventId: string
    leaseMs: number
    now?: number
    workerId: string
  }): Promise<boolean> {
    const now = new Date(args.now ?? Date.now())
    const rows = await this.db
      .update(outboxEvents)
      .set({
        leaseExpiresAt: new Date(now.getTime() + normalizeLeaseMs(args.leaseMs)),
        updatedAt: now,
      })
      .where(and(
        eq(outboxEvents.id, args.eventId),
        eq(outboxEvents.status, 'publishing'),
        eq(outboxEvents.leaseOwner, args.workerId),
      ))
      .returning({ id: outboxEvents.id })
    return rows.length > 0
  }

  async recoverExpiredLeases(args: {
    limit?: number
    now?: number
  } = {}): Promise<{ deadLettered: number; requeued: number }> {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 1_000)
    const now = new Date(args.now ?? Date.now())
    const result = await this.db.execute<{ status: 'dead_letter' | 'pending' }>(sql`
      WITH candidates AS (
        SELECT id
        FROM outbox_events
        WHERE status = 'publishing' AND lease_expires_at <= ${now}
        ORDER BY lease_expires_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      ), recovered AS (
        UPDATE outbox_events event
        SET
          status = CASE
            WHEN event.attempts >= event.max_attempts THEN 'dead_letter'::overlay_outbox_event_status
            ELSE 'pending'::overlay_outbox_event_status
          END,
          available_at = ${now},
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error = COALESCE(event.last_error, 'Outbox publisher lease expired'),
          dead_lettered_at = CASE
            WHEN event.attempts >= event.max_attempts THEN ${now}::timestamptz
            ELSE NULL::timestamptz
          END,
          updated_at = ${now}
        FROM candidates
        WHERE event.id = candidates.id
        RETURNING event.status
      )
      SELECT status FROM recovered
    `)
    return {
      deadLettered: result.rows.filter((row) => row.status === 'dead_letter').length,
      requeued: result.rows.filter((row) => row.status === 'pending').length,
    }
  }
}

function normalizeLeaseMs(value: number): number {
  if (!Number.isFinite(value) || value < 1_000) throw new Error('Outbox lease must be at least 1000ms')
  return Math.min(value, 60 * 60_000)
}

function normalizeMaxAttempts(value = 10): number {
  return Number.isInteger(value) ? Math.min(Math.max(value, 1), 100) : 10
}

function requireValue(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function truncateError(value: string): string {
  return value.slice(0, 8_192)
}
