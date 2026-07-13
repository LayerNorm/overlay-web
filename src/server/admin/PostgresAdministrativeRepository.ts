import 'server-only'

import { sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import type {
  AdministrativePrincipal,
  AdministrativeRepository,
  AdministrativeRole,
} from './AdministrativeRepository'

type Row = Omit<AdministrativePrincipal, 'createdAt' | 'updatedAt' | 'revokedAt'> & {
  createdAt: Date | string
  updatedAt: Date | string
  revokedAt: Date | string | null
}

export class PostgresAdministrativeRepository implements AdministrativeRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async get(args: { userId: string }): Promise<AdministrativePrincipal | null> {
    const result = await this.db.execute<Row>(sql`
      SELECT user_id AS "userId", role, granted_by AS "grantedBy", reason,
             created_at AS "createdAt", updated_at AS "updatedAt",
             revoked_at AS "revokedAt", revoked_by AS "revokedBy"
      FROM administrative_principals WHERE user_id = ${args.userId} LIMIT 1
    `)
    return result.rows[0] ? fromRow(result.rows[0]) : null
  }

  async list(): Promise<AdministrativePrincipal[]> {
    const result = await this.db.execute<Row>(sql`
      SELECT user_id AS "userId", role, granted_by AS "grantedBy", reason,
             created_at AS "createdAt", updated_at AS "updatedAt",
             revoked_at AS "revokedAt", revoked_by AS "revokedBy"
      FROM administrative_principals ORDER BY created_at DESC
    `)
    return result.rows.map(fromRow)
  }

  async grant(args: {
    grantedBy: string
    reason?: string
    role: AdministrativeRole
    userId: string
  }): Promise<AdministrativePrincipal> {
    const result = await this.db.execute<Row>(sql`
      INSERT INTO administrative_principals (user_id, role, granted_by, reason)
      VALUES (${args.userId}, ${args.role}, ${args.grantedBy}, ${args.reason ?? null})
      ON CONFLICT (user_id) DO UPDATE SET
        role = EXCLUDED.role, granted_by = EXCLUDED.granted_by,
        reason = EXCLUDED.reason, revoked_at = NULL, revoked_by = NULL, updated_at = now()
      RETURNING user_id AS "userId", role, granted_by AS "grantedBy", reason,
                created_at AS "createdAt", updated_at AS "updatedAt",
                revoked_at AS "revokedAt", revoked_by AS "revokedBy"
    `)
    return fromRow(result.rows[0]!)
  }

  async revoke(args: { revokedBy: string; userId: string }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE administrative_principals
      SET revoked_at = COALESCE(revoked_at, now()), revoked_by = ${args.revokedBy}, updated_at = now()
      WHERE user_id = ${args.userId}
    `)
    return result.rowCount === 1
  }
}

function fromRow(row: Row): AdministrativePrincipal {
  return {
    userId: row.userId,
    role: row.role,
    grantedBy: row.grantedBy ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: millis(row.createdAt),
    updatedAt: millis(row.updatedAt),
    revokedAt: row.revokedAt ? millis(row.revokedAt) : undefined,
    revokedBy: row.revokedBy ?? undefined,
  }
}

function millis(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}
