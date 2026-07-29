import 'server-only'

import { sql } from 'drizzle-orm'
import type {
  CreateGovernanceAccessReviewInput,
  CreateGovernancePolicyVersionInput,
  GovernanceAccessReview,
  GovernanceAccessReviewStatus,
  GovernancePolicy,
  GovernancePolicyStatus,
  GovernanceRepository,
  GovernedResourceType,
} from '@overlay/app-core'
import type { ResourceGrant } from '@overlay/authz-contracts'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'

type DateValue = Date | string

type PolicyRow = {
  id: string
  resourceType: GovernedResourceType
  resourceId: string
  version: number
  status: GovernancePolicyStatus
  retentionUntil: DateValue | null
  legalHold: boolean
  notes: string | null
  createdBy: string
  approvedBy: string | null
  approvedAt: DateValue | null
  rejectedBy: string | null
  rejectedAt: DateValue | null
  createdAt: DateValue
  updatedAt: DateValue
}

type ReviewRow = {
  id: string
  resourceType: GovernedResourceType
  resourceId: string
  status: GovernanceAccessReviewStatus
  ownerUserId: string | null
  grants: unknown
  createdBy: string
  reviewerUserId: string | null
  notes: string | null
  dueAt: DateValue | null
  createdAt: DateValue
  completedAt: DateValue | null
}

export class PostgresGovernanceRepository implements GovernanceRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async createPolicyVersion(
    input: CreateGovernancePolicyVersionInput,
  ): Promise<GovernancePolicy> {
    return await this.db.transaction(async (tx) => {
      await lockResource(tx, input.resourceType, input.resourceId)
      const versions = await tx.execute<{ version: number | string }>(sql`
        SELECT COALESCE(MAX(version), 0) AS version
        FROM governance_policies
        WHERE resource_type = ${input.resourceType}
          AND resource_id = ${input.resourceId}
      `)
      const version = Number(versions.rows[0]?.version ?? 0) + 1
      const result = await tx.execute<PolicyRow>(sql`
        INSERT INTO governance_policies (
          id, resource_type, resource_id, version, status, retention_until,
          legal_hold, notes, created_by
        ) VALUES (
          ${input.id}, ${input.resourceType}, ${input.resourceId}, ${version},
          'draft', ${dateOrNull(input.retentionUntil)}, ${input.legalHold},
          ${input.notes ?? null}, ${input.createdBy}
        )
        RETURNING ${policyColumns}
      `)
      return policyFromRow(required(result.rows[0], 'create governance policy'))
    })
  }

  async getPolicy(id: string): Promise<GovernancePolicy | null> {
    const result = await this.db.execute<PolicyRow>(sql`
      SELECT ${policyColumns}
      FROM governance_policies
      WHERE id = ${id}
      LIMIT 1
    `)
    return result.rows[0] ? policyFromRow(result.rows[0]) : null
  }

  async getActivePolicy(args: {
    resourceType: GovernedResourceType
    resourceId: string
  }): Promise<GovernancePolicy | null> {
    const result = await this.db.execute<PolicyRow>(sql`
      SELECT ${policyColumns}
      FROM governance_policies
      WHERE resource_type = ${args.resourceType}
        AND resource_id = ${args.resourceId}
        AND status = 'active'
      LIMIT 1
    `)
    return result.rows[0] ? policyFromRow(result.rows[0]) : null
  }

  async listPolicies(args: {
    resourceType?: GovernedResourceType
    resourceId?: string
    status?: GovernancePolicyStatus
  } = {}): Promise<GovernancePolicy[]> {
    const result = await this.db.execute<PolicyRow>(sql`
      SELECT ${policyColumns}
      FROM governance_policies
      WHERE ${args.resourceType ? sql`resource_type = ${args.resourceType}` : sql`true`}
        AND ${args.resourceId ? sql`resource_id = ${args.resourceId}` : sql`true`}
        AND ${args.status ? sql`status = ${args.status}` : sql`true`}
      ORDER BY updated_at DESC, resource_type, resource_id, version DESC
    `)
    return result.rows.map(policyFromRow)
  }

  async approvePolicy(args: {
    id: string
    approvedBy: string
    approvedAt: number
  }): Promise<GovernancePolicy | null> {
    return await this.db.transaction(async (tx) => {
      const currentResult = await tx.execute<PolicyRow>(sql`
        SELECT ${policyColumns}
        FROM governance_policies
        WHERE id = ${args.id}
        FOR UPDATE
      `)
      const current = currentResult.rows[0]
      if (!current || current.status !== 'draft') return null
      await lockResource(tx, current.resourceType, current.resourceId)
      await tx.execute(sql`
        UPDATE governance_policies
        SET status = 'superseded', updated_at = ${new Date(args.approvedAt)}
        WHERE resource_type = ${current.resourceType}
          AND resource_id = ${current.resourceId}
          AND status = 'active'
      `)
      const result = await tx.execute<PolicyRow>(sql`
        UPDATE governance_policies
        SET status = 'active',
            approved_by = ${args.approvedBy},
            approved_at = ${new Date(args.approvedAt)},
            updated_at = ${new Date(args.approvedAt)}
        WHERE id = ${args.id} AND status = 'draft'
        RETURNING ${policyColumns}
      `)
      return result.rows[0] ? policyFromRow(result.rows[0]) : null
    })
  }

  async rejectPolicy(args: {
    id: string
    rejectedBy: string
    rejectedAt: number
  }): Promise<GovernancePolicy | null> {
    const result = await this.db.execute<PolicyRow>(sql`
      UPDATE governance_policies
      SET status = 'rejected',
          rejected_by = ${args.rejectedBy},
          rejected_at = ${new Date(args.rejectedAt)},
          updated_at = ${new Date(args.rejectedAt)}
      WHERE id = ${args.id} AND status = 'draft'
      RETURNING ${policyColumns}
    `)
    return result.rows[0] ? policyFromRow(result.rows[0]) : null
  }

  async createAccessReview(
    input: CreateGovernanceAccessReviewInput,
  ): Promise<GovernanceAccessReview> {
    const result = await this.db.execute<ReviewRow>(sql`
      INSERT INTO governance_access_reviews (
        id, resource_type, resource_id, status, owner_user_id, grants,
        created_by, notes, due_at
      ) VALUES (
        ${input.id}, ${input.resourceType}, ${input.resourceId}, 'open',
        ${input.ownerUserId ?? null}, ${JSON.stringify(input.grants)}::jsonb,
        ${input.createdBy}, ${input.notes ?? null}, ${dateOrNull(input.dueAt)}
      )
      RETURNING ${reviewColumns}
    `)
    return reviewFromRow(required(result.rows[0], 'create governance access review'))
  }

  async getAccessReview(id: string): Promise<GovernanceAccessReview | null> {
    const result = await this.db.execute<ReviewRow>(sql`
      SELECT ${reviewColumns}
      FROM governance_access_reviews
      WHERE id = ${id}
      LIMIT 1
    `)
    return result.rows[0] ? reviewFromRow(result.rows[0]) : null
  }

  async listAccessReviews(args: {
    resourceType?: GovernedResourceType
    resourceId?: string
    status?: GovernanceAccessReviewStatus
  } = {}): Promise<GovernanceAccessReview[]> {
    const result = await this.db.execute<ReviewRow>(sql`
      SELECT ${reviewColumns}
      FROM governance_access_reviews
      WHERE ${args.resourceType ? sql`resource_type = ${args.resourceType}` : sql`true`}
        AND ${args.resourceId ? sql`resource_id = ${args.resourceId}` : sql`true`}
        AND ${args.status ? sql`status = ${args.status}` : sql`true`}
      ORDER BY created_at DESC, id
    `)
    return result.rows.map(reviewFromRow)
  }

  async completeAccessReview(args: {
    id: string
    reviewerUserId: string
    notes?: string
    completedAt: number
  }): Promise<GovernanceAccessReview | null> {
    const result = await this.db.execute<ReviewRow>(sql`
      UPDATE governance_access_reviews
      SET status = 'completed',
          reviewer_user_id = ${args.reviewerUserId},
          notes = COALESCE(${args.notes ?? null}, notes),
          completed_at = ${new Date(args.completedAt)}
      WHERE id = ${args.id} AND status = 'open'
      RETURNING ${reviewColumns}
    `)
    return result.rows[0] ? reviewFromRow(result.rows[0]) : null
  }

  async removeForResource(args: {
    resourceType: GovernedResourceType
    resourceId: string
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        DELETE FROM governance_access_reviews
        WHERE resource_type = ${args.resourceType} AND resource_id = ${args.resourceId}
      `)
      await tx.execute(sql`
        DELETE FROM governance_policies
        WHERE resource_type = ${args.resourceType} AND resource_id = ${args.resourceId}
      `)
    })
  }
}

const policyColumns = sql.raw(`
  id,
  resource_type AS "resourceType",
  resource_id AS "resourceId",
  version,
  status,
  retention_until AS "retentionUntil",
  legal_hold AS "legalHold",
  notes,
  created_by AS "createdBy",
  approved_by AS "approvedBy",
  approved_at AS "approvedAt",
  rejected_by AS "rejectedBy",
  rejected_at AS "rejectedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`)

const reviewColumns = sql.raw(`
  id,
  resource_type AS "resourceType",
  resource_id AS "resourceId",
  status,
  owner_user_id AS "ownerUserId",
  grants,
  created_by AS "createdBy",
  reviewer_user_id AS "reviewerUserId",
  notes,
  due_at AS "dueAt",
  created_at AS "createdAt",
  completed_at AS "completedAt"
`)

function policyFromRow(row: PolicyRow): GovernancePolicy {
  return {
    id: row.id,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    version: Number(row.version),
    status: row.status,
    retentionUntil: millis(row.retentionUntil),
    legalHold: row.legalHold,
    notes: row.notes ?? undefined,
    createdBy: row.createdBy,
    approvedBy: row.approvedBy ?? undefined,
    approvedAt: millis(row.approvedAt),
    rejectedBy: row.rejectedBy ?? undefined,
    rejectedAt: millis(row.rejectedAt),
    createdAt: requiredMillis(row.createdAt),
    updatedAt: requiredMillis(row.updatedAt),
  }
}

function reviewFromRow(row: ReviewRow): GovernanceAccessReview {
  return {
    id: row.id,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    status: row.status,
    ownerUserId: row.ownerUserId ?? undefined,
    grants: grantsFromJson(row.grants),
    createdBy: row.createdBy,
    reviewerUserId: row.reviewerUserId ?? undefined,
    notes: row.notes ?? undefined,
    dueAt: millis(row.dueAt),
    createdAt: requiredMillis(row.createdAt),
    completedAt: millis(row.completedAt),
  }
}

function grantsFromJson(value: unknown): ResourceGrant[] {
  if (Array.isArray(value)) return value as ResourceGrant[]
  if (typeof value === 'string') {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed as ResourceGrant[] : []
  }
  return []
}

function dateOrNull(value?: number): Date | null {
  return value === undefined ? null : new Date(value)
}

function millis(value: DateValue | null): number | undefined {
  return value === null ? undefined : new Date(value).getTime()
}

function requiredMillis(value: DateValue): number {
  return new Date(value).getTime()
}

function required<T>(value: T | undefined, operation: string): T {
  if (value === undefined) throw new Error(`Postgres failed to ${operation}`)
  return value
}

async function lockResource(
  tx: Parameters<Parameters<OverlayPostgresDb['transaction']>[0]>[0],
  resourceType: GovernedResourceType,
  resourceId: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext(${`${resourceType}:${resourceId}`}))
  `)
}
