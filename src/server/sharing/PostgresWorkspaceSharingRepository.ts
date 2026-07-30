import 'server-only'

import { sql } from 'drizzle-orm'
import type { WorkspaceResourceGrant } from '@overlay/workspace-contracts'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import type { UpsertWorkspaceResourceGrant, WorkspaceSharingRepository } from './WorkspaceSharingRepository'

type GrantRow = Omit<WorkspaceResourceGrant, 'createdAt' | 'updatedAt'> & {
  createdAt: Date | string
  updatedAt: Date | string
}

export class PostgresWorkspaceSharingRepository implements WorkspaceSharingRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async upsert(input: UpsertWorkspaceResourceGrant): Promise<WorkspaceResourceGrant> {
    const result = await this.db.execute<GrantRow>(sql`
      INSERT INTO workspace_resource_grants (
        id, workspace_id, resource_type, resource_id, target_type, target_id,
        access_role, granted_by_principal_id, created_at, updated_at
      ) VALUES (
        ${input.id}, ${input.workspaceId}, ${input.resourceType}, ${input.resourceId},
        ${input.targetType}, ${input.targetId}, ${input.accessRole},
        ${input.grantedByPrincipalId}, ${new Date(input.now)}, ${new Date(input.now)}
      )
      ON CONFLICT (workspace_id, resource_type, resource_id, target_type, target_id)
      DO UPDATE SET
        access_role = excluded.access_role,
        granted_by_principal_id = excluded.granted_by_principal_id,
        updated_at = excluded.updated_at
      RETURNING ${grantColumns}
    `)
    if (!result.rows[0]) throw new Error('WORKSPACE_RESOURCE_GRANT_UPSERT_FAILED')
    return grantFromRow(result.rows[0])
  }

  async remove(args: { grantId: string; workspaceId: string }): Promise<boolean> {
    const result = await this.db.execute(sql`
      DELETE FROM workspace_resource_grants
      WHERE id = ${args.grantId} AND workspace_id = ${args.workspaceId}
      RETURNING id
    `)
    return result.rows.length > 0
  }

  async listForResource(args: Parameters<WorkspaceSharingRepository['listForResource']>[0]) {
    const result = await this.db.execute<GrantRow>(sql`
      SELECT ${grantColumns}
      FROM workspace_resource_grants
      WHERE workspace_id = ${args.workspaceId}
        AND resource_type = ${args.resourceType}
        AND resource_id = ${args.resourceId}
      ORDER BY created_at, id
    `)
    return result.rows.map(grantFromRow)
  }

  async listForTargets(args: Parameters<WorkspaceSharingRepository['listForTargets']>[0]) {
    const targetPredicates = []
    if (args.principalIds.length > 0) targetPredicates.push(sql`
      (target_type = 'principal' AND target_id IN (${sql.join(args.principalIds.map((id) => sql`${id}`), sql`, `)}))
    `)
    if (args.teamIds.length > 0) targetPredicates.push(sql`
      (target_type = 'team' AND target_id IN (${sql.join(args.teamIds.map((id) => sql`${id}`), sql`, `)}))
    `)
    if (args.roomIds.length > 0) targetPredicates.push(sql`
      (target_type = 'room' AND target_id IN (${sql.join(args.roomIds.map((id) => sql`${id}`), sql`, `)}))
    `)
    if (targetPredicates.length === 0) return []
    const result = await this.db.execute<GrantRow>(sql`
      SELECT ${grantColumns}
      FROM workspace_resource_grants
      WHERE workspace_id = ${args.workspaceId}
        AND (${sql.join(targetPredicates, sql` OR `)})
        ${args.resourceType ? sql`AND resource_type = ${args.resourceType}` : sql``}
      ORDER BY created_at, id
    `)
    return result.rows.map(grantFromRow)
  }
}

const grantColumns = sql.raw(`
  id, workspace_id AS "workspaceId", resource_type AS "resourceType",
  resource_id AS "resourceId", target_type AS "targetType", target_id AS "targetId",
  access_role AS "accessRole", granted_by_principal_id AS "grantedByPrincipalId",
  created_at AS "createdAt", updated_at AS "updatedAt"
`)

function grantFromRow(row: GrantRow): WorkspaceResourceGrant {
  return {
    ...row,
    createdAt: new Date(row.createdAt).getTime(),
    updatedAt: new Date(row.updatedAt).getTime(),
  }
}
