import 'server-only'

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import type { ApiKeyRecord, ApiKeyRepository } from './ApiKeyRepository'

type Row = {
  createdAt: Date | string
  createdBy: string | null
  createdFromIp: string | null
  expiresAt: Date | string
  id: string
  lastUsedAt: Date | string | null
  lastUsedIp: string | null
  name: string | null
  revokedAt: Date | string | null
  revokedReason: string | null
  scopes: ApiKeyRecord['scopes']
  userId: string
}

export class PostgresApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async create(args: Omit<ApiKeyRecord, 'id'> & { keyHash: string }): Promise<ApiKeyRecord> {
    const id = `api_key_${randomUUID()}`
    const result = await this.db.execute<Row>(sql`
      INSERT INTO api_keys (
        id, key_hash, name, user_id, scopes, expires_at, created_at,
        created_by, created_from_ip
      ) VALUES (
        ${id}, ${args.keyHash}, ${args.name ?? null}, ${args.userId}, string_to_array(${args.scopes.join(',')}, ','),
        ${new Date(args.expiresAt)}, ${new Date(args.createdAt)}, ${args.createdBy ?? null},
        ${args.createdFromIp ?? null}
      )
      RETURNING id, name, user_id AS "userId", scopes, expires_at AS "expiresAt",
                created_at AS "createdAt", created_by AS "createdBy",
                created_from_ip AS "createdFromIp", last_used_at AS "lastUsedAt",
                last_used_ip AS "lastUsedIp", revoked_at AS "revokedAt",
                revoked_reason AS "revokedReason"
    `)
    return fromRow(result.rows[0]!)
  }

  async listByUser(args: { userId: string }): Promise<ApiKeyRecord[]> {
    const result = await this.db.execute<Row>(sql`
      SELECT id, name, user_id AS "userId", scopes, expires_at AS "expiresAt",
             created_at AS "createdAt", created_by AS "createdBy",
             created_from_ip AS "createdFromIp", last_used_at AS "lastUsedAt",
             last_used_ip AS "lastUsedIp", revoked_at AS "revokedAt",
             revoked_reason AS "revokedReason"
      FROM api_keys
      WHERE user_id = ${args.userId}
      ORDER BY created_at DESC
    `)
    return result.rows.map(fromRow)
  }

  async validateAndTouch(args: {
    keyHash: string
    lastUsedAt: number
    lastUsedIp?: string
    now: number
  }): Promise<ApiKeyRecord | null> {
    const result = await this.db.execute<Row>(sql`
      UPDATE api_keys
      SET last_used_at = CASE
            WHEN last_used_at IS NULL OR last_used_at < ${new Date(args.now - 60_000)} OR last_used_ip IS DISTINCT FROM ${args.lastUsedIp ?? null}
              THEN ${new Date(args.lastUsedAt)} ELSE last_used_at END,
          last_used_ip = CASE
            WHEN last_used_at IS NULL OR last_used_at < ${new Date(args.now - 60_000)} OR last_used_ip IS DISTINCT FROM ${args.lastUsedIp ?? null}
              THEN ${args.lastUsedIp ?? null} ELSE last_used_ip END
      WHERE key_hash = ${args.keyHash}
        AND revoked_at IS NULL
        AND expires_at > ${new Date(args.now)}
      RETURNING id, name, user_id AS "userId", scopes, expires_at AS "expiresAt",
                created_at AS "createdAt", created_by AS "createdBy",
                created_from_ip AS "createdFromIp", last_used_at AS "lastUsedAt",
                last_used_ip AS "lastUsedIp", revoked_at AS "revokedAt",
                revoked_reason AS "revokedReason"
    `)
    return result.rows[0] ? fromRow(result.rows[0]) : null
  }

  async revokeByHash(args: {
    keyHash: string
    revokedAt: number
    revokedReason?: string
    userId?: string
  }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ${new Date(args.revokedAt)}),
                          revoked_reason = COALESCE(revoked_reason, ${args.revokedReason ?? null})
      WHERE key_hash = ${args.keyHash}
        AND (${args.userId ?? null}::text IS NULL OR user_id = ${args.userId ?? null})
    `)
    return result.rowCount === 1
  }

  async revokeById(args: {
    id: string
    revokedAt: number
    revokedReason?: string
    userId: string
  }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE api_keys SET revoked_at = COALESCE(revoked_at, ${new Date(args.revokedAt)}),
                          revoked_reason = COALESCE(revoked_reason, ${args.revokedReason ?? null})
      WHERE id = ${args.id} AND user_id = ${args.userId}
    `)
    return result.rowCount === 1
  }

  async rotateById(args: {
    id: string
    keyHash: string
    name?: string
    userId: string
    scopes: ApiKeyRecord['scopes']
    expiresAt: number
    createdAt: number
    createdBy?: string
    createdFromIp?: string
    revokedReason: string
  }): Promise<ApiKeyRecord | null> {
    return await this.db.transaction(async (tx) => {
      const revoked = await tx.execute(sql`
        UPDATE api_keys
        SET revoked_at = ${new Date(args.createdAt)}, revoked_reason = ${args.revokedReason}
        WHERE id = ${args.id} AND user_id = ${args.userId}
          AND revoked_at IS NULL AND expires_at > ${new Date(args.createdAt)}
      `)
      if (revoked.rowCount !== 1) return null
      const id = `api_key_${randomUUID()}`
      const inserted = await tx.execute<Row>(sql`
        INSERT INTO api_keys (
          id, key_hash, name, user_id, scopes, expires_at, created_at, created_by, created_from_ip
        ) VALUES (
          ${id}, ${args.keyHash}, ${args.name ?? null}, ${args.userId}, string_to_array(${args.scopes.join(',')}, ','),
          ${new Date(args.expiresAt)}, ${new Date(args.createdAt)}, ${args.createdBy ?? null},
          ${args.createdFromIp ?? null}
        )
        RETURNING id, name, user_id AS "userId", scopes, expires_at AS "expiresAt",
                  created_at AS "createdAt", created_by AS "createdBy",
                  created_from_ip AS "createdFromIp", last_used_at AS "lastUsedAt",
                  last_used_ip AS "lastUsedIp", revoked_at AS "revokedAt",
                  revoked_reason AS "revokedReason"
      `)
      return fromRow(inserted.rows[0]!)
    })
  }
}

function fromRow(row: Row): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name ?? undefined,
    userId: row.userId,
    scopes: row.scopes,
    expiresAt: millis(row.expiresAt),
    createdAt: millis(row.createdAt),
    createdBy: row.createdBy ?? undefined,
    createdFromIp: row.createdFromIp ?? undefined,
    lastUsedAt: row.lastUsedAt ? millis(row.lastUsedAt) : undefined,
    lastUsedIp: row.lastUsedIp ?? undefined,
    revokedAt: row.revokedAt ? millis(row.revokedAt) : undefined,
    revokedReason: row.revokedReason ?? undefined,
  }
}

function millis(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}
