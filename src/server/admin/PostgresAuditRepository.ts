import 'server-only'

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import type { AuditEventRecord, AuditRepository } from './AuditRepository'

type AuditRow = Omit<AuditEventRecord, 'createdAt'> & { createdAt: Date | string }

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async append(args: Omit<AuditEventRecord, 'id' | 'createdAt'> & {
    createdAt?: number
    id?: string
  }): Promise<AuditEventRecord> {
    const id = args.id ?? `audit_${randomUUID()}`
    const createdAt = args.createdAt ?? Date.now()
    const result = await this.db.execute<AuditRow>(sql`
      INSERT INTO audit_events (
        id, actor_type, actor_user_id, actor_api_key_id, action, resource_type,
        resource_id, outcome, request_id, ip_address, metadata, created_at
      ) VALUES (
        ${id}, ${args.actorType}, ${args.actorUserId ?? null}, ${args.actorApiKeyId ?? null},
        ${requiredText(args.action, 'action')}, ${requiredText(args.resourceType, 'resourceType')},
        ${args.resourceId ?? null}, ${args.outcome}, ${args.requestId ?? null},
        ${args.ipAddress ?? null}, ${JSON.stringify(sanitizeMetadata(args.metadata))}::jsonb,
        ${new Date(createdAt)}
      )
      RETURNING id, actor_type AS "actorType", actor_user_id AS "actorUserId",
                actor_api_key_id AS "actorApiKeyId", action, resource_type AS "resourceType",
                resource_id AS "resourceId", outcome, request_id AS "requestId",
                ip_address AS "ipAddress", metadata, created_at AS "createdAt"
    `)
    return fromAuditRow(result.rows[0]!)
  }

  async list(args: {
    action?: string
    actorUserId?: string
    before?: number
    limit?: number
    resourceType?: string
  } = {}): Promise<AuditEventRecord[]> {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200)
    const before = new Date(args.before ?? Date.now() + 1)
    const result = await this.db.execute<AuditRow>(sql`
      SELECT id, actor_type AS "actorType", actor_user_id AS "actorUserId",
             actor_api_key_id AS "actorApiKeyId", action, resource_type AS "resourceType",
             resource_id AS "resourceId", outcome, request_id AS "requestId",
             ip_address AS "ipAddress", metadata, created_at AS "createdAt"
      FROM audit_events
      WHERE created_at < ${before}
        AND (${args.action ?? null}::text IS NULL OR action = ${args.action ?? null})
        AND (${args.actorUserId ?? null}::text IS NULL OR actor_user_id = ${args.actorUserId ?? null})
        AND (${args.resourceType ?? null}::text IS NULL OR resource_type = ${args.resourceType ?? null})
      ORDER BY created_at DESC
      LIMIT ${limit}
    `)
    return result.rows.map(fromAuditRow)
  }
}

function fromAuditRow(row: AuditRow): AuditEventRecord {
  return {
    ...row,
    actorUserId: row.actorUserId ?? undefined,
    actorApiKeyId: row.actorApiKeyId ?? undefined,
    resourceId: row.resourceId ?? undefined,
    requestId: row.requestId ?? undefined,
    ipAddress: row.ipAddress ?? undefined,
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : new Date(row.createdAt).getTime(),
  }
}

function requiredText(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${field} is required`)
  return trimmed.slice(0, 160)
}

function sanitizeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeObject(value, 0)
}

function sanitizeObject(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  if (depth > 4) return { truncated: true }
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, 50)) {
    if (/(secret|token|password|authorization|cookie|api.?key)/i.test(key)) {
      result[key] = '[REDACTED]'
    } else if (typeof item === 'string') {
      result[key] = item.slice(0, 1000)
    } else if (Array.isArray(item)) {
      result[key] = item.slice(0, 50).map((entry) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? sanitizeObject(entry as Record<string, unknown>, depth + 1)
          : typeof entry === 'string' ? entry.slice(0, 1000) : entry,
      )
    } else if (item && typeof item === 'object') {
      result[key] = sanitizeObject(item as Record<string, unknown>, depth + 1)
    } else {
      result[key] = item
    }
  }
  return result
}
