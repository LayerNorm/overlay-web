import 'server-only'

import { sql } from 'drizzle-orm'
import type { WorkspaceAgentDefinition, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import type {
  CreateWorkspaceAgentRecord,
  UpdateWorkspaceAgentRecord,
  WorkspaceAgentRepository,
} from './WorkspaceAgentRepository'

type AgentRow = Omit<WorkspaceAgentDefinition, 'createdAt' | 'updatedAt' | 'archivedAt' | 'visibility'> & {
  createdAt: Date | string
  updatedAt: Date | string
  archivedAt: Date | string | null
  visibility: string | null
  teamIds: string[] | null
  roomCount: number | string
}

export class PostgresWorkspaceAgentRepository implements WorkspaceAgentRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async create(input: CreateWorkspaceAgentRecord): Promise<WorkspaceAgentDirectoryItem> {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.workspaceId}, 0))`)
      await tx.execute(sql`
        INSERT INTO workspace_principals (
          id, workspace_id, type, agent_id, display_name, created_by_principal_id,
          created_at, updated_at
        ) VALUES (
          ${input.principalId}, ${input.workspaceId}, 'agent', ${input.agentId}, ${input.name},
          ${input.createdByPrincipalId}, ${new Date(input.now)}, ${new Date(input.now)}
        )
      `)
      await tx.execute(sql`
        INSERT INTO workspace_memberships (
          workspace_id, principal_id, role, status, invited_by_principal_id, joined_at, updated_at
        ) VALUES (
          ${input.workspaceId}, ${input.principalId}, 'member', 'active',
          ${input.createdByPrincipalId}, ${new Date(input.now)}, ${new Date(input.now)}
        )
      `)
      await tx.execute(sql`
        INSERT INTO workspace_agent_definitions (
          id, workspace_id, principal_id, name, description, instructions, harness,
          model_id, avatar_color, allowed_tool_ids, invocation_policy, visibility,
          created_by_principal_id, created_at, updated_at
        ) VALUES (
          ${input.agentId}, ${input.workspaceId}, ${input.principalId}, ${input.name},
          ${input.description ?? null}, ${input.instructions}, ${input.harness}, ${input.modelId},
          ${input.avatarColor ?? null}, ${JSON.stringify(input.allowedToolIds)}::jsonb, 'mention',
          ${input.visibility},
          ${input.createdByPrincipalId}, ${new Date(input.now)}, ${new Date(input.now)}
        )
      `)
      for (const teamId of [...new Set(input.teamIds)]) {
        await tx.execute(sql`
          INSERT INTO workspace_team_members (
            team_id, workspace_id, principal_id, principal_type, added_by_principal_id, created_at
          )
          SELECT id, workspace_id, ${input.principalId}, 'agent', ${input.createdByPrincipalId},
            ${new Date(input.now)}
          FROM workspace_teams
          WHERE id = ${teamId} AND workspace_id = ${input.workspaceId} AND archived_at IS NULL
          ON CONFLICT (team_id, principal_id) DO NOTHING
        `)
      }
      // Creator-only agents join no channels implicitly: only their creator can
      // place them anywhere, and only the creator can invoke them.
      if (input.visibility !== 'creator') {
        await tx.execute(sql`
          INSERT INTO conversation_participants (
            conversation_id, workspace_id, principal_id, principal_type, role, status,
            notification_level, joined_at, updated_at
          )
          SELECT id, workspace_id, ${input.principalId}, 'agent', 'member', 'active',
            'mentions', ${new Date(input.now)}, ${new Date(input.now)}
          FROM conversations
          WHERE workspace_id = ${input.workspaceId}
            AND conversation_type = 'channel'
            AND channel_visibility = 'public'
            AND deleted_at IS NULL
          ON CONFLICT (conversation_id, principal_id) DO UPDATE SET
            status = 'active', removed_at = NULL, updated_at = EXCLUDED.updated_at
        `)
      }
      await tx.execute(sql`
        INSERT INTO workspace_resource_scopes (
          workspace_id, resource_type, resource_id, created_at, updated_at
        ) VALUES (
          ${input.workspaceId}, 'agent', ${input.agentId}, ${new Date(input.now)}, ${new Date(input.now)}
        )
        ON CONFLICT (resource_type, resource_id) DO NOTHING
      `)
      const created = await selectAgent(tx, input.workspaceId, input.agentId)
      if (!created) throw new Error('WORKSPACE_AGENT_CREATE_FAILED')
      return created
    })
  }

  async get(args: { agentId: string; workspaceId: string }) {
    return await selectAgent(this.db, args.workspaceId, args.agentId)
  }

  async list(args: { workspaceId: string; includeArchived?: boolean }) {
    const result = await this.db.execute<AgentRow>(sql`
      SELECT ${agentColumns}
      FROM workspace_agent_definitions a
      WHERE a.workspace_id = ${args.workspaceId}
        AND ${args.includeArchived ? sql`true` : sql`a.archived_at IS NULL`}
      ORDER BY a.name, a.id
    `)
    return result.rows.map(agentFromRow)
  }

  async update(input: UpdateWorkspaceAgentRecord) {
    return await this.db.transaction(async (tx) => {
      const current = await selectAgent(tx, input.workspaceId, input.agentId)
      if (!current || current.archivedAt) return null
      const next = {
        name: input.name ?? current.name,
        description: input.description === undefined ? current.description : input.description,
        instructions: input.instructions ?? current.instructions,
        harness: input.harness ?? current.harness,
        modelId: input.modelId ?? current.modelId,
        avatarColor: input.avatarColor === undefined ? current.avatarColor : input.avatarColor,
        allowedToolIds: input.allowedToolIds ?? current.allowedToolIds,
        visibility: input.visibility ?? current.visibility,
      }
      await tx.execute(sql`
        UPDATE workspace_agent_definitions SET
          name = ${next.name}, description = ${next.description ?? null},
          instructions = ${next.instructions}, harness = ${next.harness}, model_id = ${next.modelId},
          avatar_color = ${next.avatarColor ?? null},
          allowed_tool_ids = ${JSON.stringify(next.allowedToolIds)}::jsonb,
          visibility = ${next.visibility},
          updated_at = ${new Date(input.now)}
        WHERE id = ${input.agentId} AND workspace_id = ${input.workspaceId} AND archived_at IS NULL
      `)
      await tx.execute(sql`
        UPDATE workspace_principals SET display_name = ${next.name}, updated_at = ${new Date(input.now)}
        WHERE id = ${current.principalId} AND workspace_id = ${input.workspaceId}
      `)
      if (input.teamIds) {
        await tx.execute(sql`
          DELETE FROM workspace_team_members
          WHERE workspace_id = ${input.workspaceId} AND principal_id = ${current.principalId}
        `)
        for (const teamId of [...new Set(input.teamIds)]) {
          await tx.execute(sql`
            INSERT INTO workspace_team_members (
              team_id, workspace_id, principal_id, principal_type, added_by_principal_id, created_at
            )
            SELECT id, workspace_id, ${current.principalId}, 'agent', ${input.updatedByPrincipalId ?? null},
              ${new Date(input.now)}
            FROM workspace_teams
            WHERE id = ${teamId} AND workspace_id = ${input.workspaceId} AND archived_at IS NULL
            ON CONFLICT (team_id, principal_id) DO NOTHING
          `)
        }
      }
      return await selectAgent(tx, input.workspaceId, input.agentId)
    })
  }

  async archive(args: { agentId: string; workspaceId: string; now: number }) {
    return await this.db.transaction(async (tx) => {
      const current = await selectAgent(tx, args.workspaceId, args.agentId)
      if (!current || current.archivedAt) return false
      if (current.isDefault || current.name.toLowerCase() === 'overlay') return false
      await tx.execute(sql`
        UPDATE workspace_agent_definitions
        SET archived_at = ${new Date(args.now)}, updated_at = ${new Date(args.now)}
        WHERE id = ${args.agentId} AND workspace_id = ${args.workspaceId}
      `)
      await tx.execute(sql`
        UPDATE workspace_principals
        SET archived_at = ${new Date(args.now)}, updated_at = ${new Date(args.now)}
        WHERE id = ${current.principalId} AND workspace_id = ${args.workspaceId}
      `)
      await tx.execute(sql`
        UPDATE workspace_memberships SET status = 'suspended', updated_at = ${new Date(args.now)}
        WHERE workspace_id = ${args.workspaceId} AND principal_id = ${current.principalId}
      `)
      await tx.execute(sql`
        UPDATE conversation_participants
        SET status = 'removed', removed_at = ${new Date(args.now)}, updated_at = ${new Date(args.now)}
        WHERE workspace_id = ${args.workspaceId} AND principal_id = ${current.principalId}
      `)
      await tx.execute(sql`
        DELETE FROM workspace_team_members
        WHERE workspace_id = ${args.workspaceId} AND principal_id = ${current.principalId}
      `)
      return true
    })
  }
}

const agentColumns = sql.raw(`
  a.id, a.workspace_id AS "workspaceId", a.principal_id AS "principalId",
  a.name, a.description, a.instructions, a.harness, a.model_id AS "modelId",
  a.avatar_color AS "avatarColor", a.allowed_tool_ids AS "allowedToolIds",
  a.invocation_policy AS "invocationPolicy",
  a.visibility AS "visibility",
  a.created_by_principal_id AS "createdByPrincipalId", a.created_at AS "createdAt",
  a.updated_at AS "updatedAt", a.archived_at AS "archivedAt",
  COALESCE((SELECT jsonb_agg(tm.team_id ORDER BY tm.team_id)
    FROM workspace_team_members tm WHERE tm.principal_id = a.principal_id), '[]'::jsonb) AS "teamIds",
  (SELECT count(*)::int FROM conversation_participants cp
    WHERE cp.principal_id = a.principal_id AND cp.status = 'active') AS "roomCount"
`)

async function selectAgent(
  db: Pick<OverlayPostgresDb, 'execute'>,
  workspaceId: string,
  agentId: string,
): Promise<WorkspaceAgentDirectoryItem | null> {
  const result = await db.execute<AgentRow>(sql`
    SELECT ${agentColumns}
    FROM workspace_agent_definitions a
    WHERE a.workspace_id = ${workspaceId} AND a.id = ${agentId}
    LIMIT 1
  `)
  return result.rows[0] ? agentFromRow(result.rows[0]) : null
}

function agentFromRow(row: AgentRow): WorkspaceAgentDirectoryItem {
  return {
    ...row,
    allowedToolIds: Array.isArray(row.allowedToolIds) ? row.allowedToolIds : [],
    // NULL predates the access-mode feature and means workspace-visible.
    visibility: row.visibility === 'creator' ? 'creator' : 'workspace',
    teamIds: Array.isArray(row.teamIds) ? row.teamIds : [],
    roomCount: Number(row.roomCount),
    createdAt: new Date(row.createdAt).getTime(),
    updatedAt: new Date(row.updatedAt).getTime(),
    archivedAt: row.archivedAt ? new Date(row.archivedAt).getTime() : undefined,
    description: row.description ?? undefined,
    avatarColor: row.avatarColor ?? undefined,
    isDefault: Boolean(row.isDefault || row.name.toLowerCase() === 'overlay'),
  }
}
