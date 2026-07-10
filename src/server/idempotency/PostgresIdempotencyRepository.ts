import 'server-only'

import { and, eq, lte, sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { apiIdempotencyKeys } from '@/server/database/postgres/schema'
import { STREAM_IDEMPOTENCY_RESPONSE_MARKER } from '@/shared/api/idempotency-markers'
import type {
  IdempotencyRepository,
  IdempotencyReservationResult,
} from './IdempotencyRepository'

export class PostgresIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async reserve(args: {
    expiresAt: number
    keyHash: string
    method: string
    path: string
    requestHash: string
    userId: string
  }): Promise<IdempotencyReservationResult> {
    return await this.db.transaction(async (tx) => {
      const now = new Date()
      await tx
        .delete(apiIdempotencyKeys)
        .where(and(
          eq(apiIdempotencyKeys.keyHash, args.keyHash),
          lte(apiIdempotencyKeys.expiresAt, now),
        ))

      const inserted = await tx
        .insert(apiIdempotencyKeys)
        .values({
          expiresAt: new Date(args.expiresAt),
          keyHash: args.keyHash,
          method: args.method.toUpperCase(),
          path: args.path,
          requestHash: args.requestHash,
          status: 'processing',
          userId: args.userId,
        })
        .onConflictDoNothing({ target: apiIdempotencyKeys.keyHash })
        .returning({ keyHash: apiIdempotencyKeys.keyHash })
      if (inserted.length > 0) return { status: 'reserved' }

      const [existing] = await tx
        .select()
        .from(apiIdempotencyKeys)
        .where(eq(apiIdempotencyKeys.keyHash, args.keyHash))
        .limit(1)
      if (!existing) return { status: 'in_flight' }
      if (existing.requestHash !== args.requestHash) return { status: 'conflict' }
      if (existing.status === 'completed') {
        return {
          status: 'replay',
          ...(existing.responseStatus !== null ? { responseStatus: existing.responseStatus } : {}),
          ...(existing.responseHeaders ? { responseHeaders: existing.responseHeaders } : {}),
          ...(existing.responseBody !== null ? { responseBody: existing.responseBody } : {}),
        }
      }
      return { status: 'in_flight' }
    })
  }

  async complete(args: {
    keyHash: string
    requestHash: string
    responseBody: string
    responseHeaders: Array<{ name: string; value: string }>
    responseStatus: number
  }): Promise<boolean> {
    const rows = await this.db
      .update(apiIdempotencyKeys)
      .set({
        responseBody: args.responseBody,
        responseHeaders: args.responseHeaders,
        responseStatus: args.responseStatus,
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(and(
        eq(apiIdempotencyKeys.keyHash, args.keyHash),
        eq(apiIdempotencyKeys.requestHash, args.requestHash),
      ))
      .returning({ keyHash: apiIdempotencyKeys.keyHash })
    return rows.length > 0
  }

  async completeStreamStarted(args: { keyHash: string; requestHash: string }): Promise<boolean> {
    return await this.complete({
      ...args,
      responseBody: STREAM_IDEMPOTENCY_RESPONSE_MARKER,
      responseHeaders: [{ name: 'x-overlay-idempotency-kind', value: 'stream' }],
      responseStatus: 200,
    })
  }

  async discard(args: { keyHash: string; requestHash: string }): Promise<boolean> {
    const rows = await this.db
      .delete(apiIdempotencyKeys)
      .where(and(
        eq(apiIdempotencyKeys.keyHash, args.keyHash),
        eq(apiIdempotencyKeys.requestHash, args.requestHash),
      ))
      .returning({ keyHash: apiIdempotencyKeys.keyHash })
    return rows.length > 0
  }

  async cleanupExpired(args: { limit?: number; now?: number } = {}): Promise<number> {
    const limit = Math.min(Math.max(args.limit ?? 500, 1), 2_000)
    const now = new Date(args.now ?? Date.now())
    const result = await this.db.execute<{ key_hash: string }>(sql`
      WITH candidates AS (
        SELECT key_hash
        FROM api_idempotency_keys
        WHERE expires_at <= ${now}
        ORDER BY expires_at ASC
        LIMIT ${limit}
      ), deleted AS (
        DELETE FROM api_idempotency_keys target
        USING candidates
        WHERE target.key_hash = candidates.key_hash
        RETURNING target.key_hash
      )
      SELECT key_hash FROM deleted
    `)
    return result.rows.length
  }
}
