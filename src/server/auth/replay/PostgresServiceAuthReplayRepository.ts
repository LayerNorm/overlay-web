import 'server-only'

import { sql } from 'drizzle-orm'
import type { ServiceAuthPayload } from '@/server/auth/service-auth'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { serviceAuthReplayNonces } from '@/server/database/postgres/schema'
import type { ServiceAuthReplayRepository } from './ServiceAuthReplayRepository'

export class PostgresServiceAuthReplayRepository implements ServiceAuthReplayRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async consume(payload: ServiceAuthPayload): Promise<boolean> {
    const now = Date.now()
    const jti = payload.jti.trim()
    const subject = payload.sub.trim()
    const method = payload.method.trim().toUpperCase()
    const path = payload.path.trim() || '/'
    if (!jti || !subject || !method || !path || !Number.isFinite(payload.exp) || payload.exp <= now) {
      return false
    }

    const rows = await this.db
      .insert(serviceAuthReplayNonces)
      .values({
        consumedAt: new Date(now),
        expiresAt: new Date(payload.exp),
        jti,
        method,
        path,
        subject,
      })
      .onConflictDoNothing({ target: serviceAuthReplayNonces.jti })
      .returning({ jti: serviceAuthReplayNonces.jti })
    return rows.length > 0
  }

  async cleanupExpired(args: { limit?: number; now?: number } = {}): Promise<number> {
    const limit = Math.min(Math.max(args.limit ?? 500, 1), 2_000)
    const now = new Date(args.now ?? Date.now())
    const result = await this.db.execute<{ jti: string }>(sql`
      WITH candidates AS (
        SELECT jti
        FROM service_auth_replay_nonces
        WHERE expires_at <= ${now}
        ORDER BY expires_at ASC
        LIMIT ${limit}
      ), deleted AS (
        DELETE FROM service_auth_replay_nonces target
        USING candidates
        WHERE target.jti = candidates.jti
        RETURNING target.jti
      )
      SELECT jti FROM deleted
    `)
    return result.rows.length
  }
}
