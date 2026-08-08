import 'server-only'

import { sql } from 'drizzle-orm'
import type {
  Workspace,
  WorkspaceAccess,
  WorkspaceInvitation,
  WorkspaceMembership,
  WorkspacePrincipal,
  WorkspaceResourceGuest,
  WorkspaceResourceScope,
  WorkspaceAuditExportRecord,
  WorkspaceIdentityMapping,
  WorkspaceSharingPolicy,
  WorkspaceTeam,
  WorkspaceTeamMember,
} from '@overlay/workspace-contracts'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import type {
  AcceptWorkspaceInvitationInput,
  SetWorkspaceSharingPolicyInput,
  CreateOrganizationWorkspaceInput,
  CreateWorkspaceInvitationInput,
  CreateWorkspacePrincipalInput,
  EnsurePersonalWorkspaceInput,
  InvitationAcceptanceResult,
  MembershipMutationResult,
  MembershipRemovalResult,
  OwnershipTransferResult,
  WorkspaceRepository,
} from './WorkspaceRepository'

type DateValue = Date | string
type WorkspaceRow = Omit<Workspace, 'createdAt' | 'updatedAt' | 'archivedAt'> & {
  createdAt: DateValue
  updatedAt: DateValue
  archivedAt: DateValue | null
}
type PrincipalRow = Omit<WorkspacePrincipal, 'createdAt' | 'updatedAt' | 'archivedAt'> & {
  createdAt: DateValue
  updatedAt: DateValue
  archivedAt: DateValue | null
}
type MembershipRow = Omit<WorkspaceMembership, 'joinedAt' | 'updatedAt'> & {
  joinedAt: DateValue
  updatedAt: DateValue
}
type AccessRow = {
  workspace: WorkspaceRow
  principal: PrincipalRow
  membership: MembershipRow
}
type TeamRow = Omit<WorkspaceTeam, 'createdAt' | 'updatedAt' | 'archivedAt'> & {
  createdAt: DateValue
  updatedAt: DateValue
  archivedAt: DateValue | null
}
type TeamMemberRow = Omit<WorkspaceTeamMember, 'createdAt'> & { createdAt: DateValue }
type InvitationRow = Omit<
  WorkspaceInvitation,
  'expiresAt' | 'createdAt' | 'updatedAt' | 'acceptedAt' | 'cancelledAt' | 'replacedAt'
> & {
  expiresAt: DateValue
  createdAt: DateValue
  updatedAt: DateValue
  acceptedAt: DateValue | null
  cancelledAt: DateValue | null
  replacedAt: DateValue | null
}
type GuestRow = Omit<
  WorkspaceResourceGuest,
  'expiresAt' | 'createdAt' | 'updatedAt' | 'revokedAt'
> & {
  expiresAt: DateValue | null
  createdAt: DateValue
  updatedAt: DateValue
  revokedAt: DateValue | null
}
type ResourceScopeRow = Omit<WorkspaceResourceScope, 'createdAt' | 'updatedAt'> & {
  createdAt: DateValue
  updatedAt: DateValue
}

type IdentityMappingRow = Omit<
  WorkspaceIdentityMapping,
  'createdAt' | 'updatedAt' | 'deprovisionedAt' | 'externalGroupIds'
> & {
  createdAt: DateValue
  updatedAt: DateValue
  deprovisionedAt: DateValue | null
  externalGroupIds: string[] | null
}

type AuditExportRow = Omit<
  WorkspaceAuditExportRecord,
  'createdAt' | 'toRecordedAt' | 'fromRecordedAt'
> & {
  createdAt: DateValue
  toRecordedAt: DateValue
  fromRecordedAt: DateValue | null
}

type SharingPolicyRow = Omit<
  WorkspaceSharingPolicy,
  | 'updatedAt'
  | 'updatedByPrincipalId'
  | 'guestExpirationDays'
  | 'allowedAgentHarnesses'
  | 'agentRunBudgetCents'
  | 'channelRetentionDays'
  | 'dataResidency'
> & {
  updatedAt: DateValue
  updatedByPrincipalId: string | null
  guestExpirationDays: number | null
  allowedAgentHarnesses: string[] | null
  agentRunBudgetCents: number | null
  channelRetentionDays: number | null
  dataResidency: string | null
}

export class PostgresWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async ensurePersonalWorkspace(input: EnsurePersonalWorkspaceInput): Promise<WorkspaceAccess> {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.userId}, 0))`)
      const existing = await selectAccess(tx, {
        userId: input.userId,
        personalOnly: true,
      })
      if (existing) return existing

      await tx.execute(sql`
        INSERT INTO workspaces (
          id, kind, name, slug, status, personal_owner_user_id, created_at, updated_at
        ) VALUES (
          ${input.workspaceId}, 'personal', 'Personal', ${input.slug}, 'active',
          ${input.userId}, ${new Date(input.now)}, ${new Date(input.now)}
        )
      `)
      await insertPrincipal(tx, {
        id: input.principalId,
        workspaceId: input.workspaceId,
        type: 'human',
        userId: input.userId,
        displayName: input.displayName,
        email: input.email,
        now: input.now,
      })
      await tx.execute(sql`
        INSERT INTO workspace_memberships (
          workspace_id, principal_id, role, status, joined_at, updated_at
        ) VALUES (
          ${input.workspaceId}, ${input.principalId}, 'owner', 'active',
          ${new Date(input.now)}, ${new Date(input.now)}
        )
      `)
      await tx.execute(sql`
        UPDATE workspaces
        SET created_by_principal_id = ${input.principalId}
        WHERE id = ${input.workspaceId}
      `)
      await tx.execute(sql`
        INSERT INTO user_workspace_preferences (user_id, active_workspace_id, updated_at)
        VALUES (${input.userId}, ${input.workspaceId}, ${new Date(input.now)})
        ON CONFLICT (user_id) DO NOTHING
      `)
      return requiredAccess(await selectAccess(tx, {
        workspaceId: input.workspaceId,
        userId: input.userId,
      }))
    })
  }

  async createOrganization(input: CreateOrganizationWorkspaceInput): Promise<WorkspaceAccess> {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO workspaces (
          id, kind, name, slug, status, created_at, updated_at
        ) VALUES (
          ${input.workspaceId}, 'organization', ${input.name}, ${input.slug}, 'active',
          ${new Date(input.now)}, ${new Date(input.now)}
        )
      `)
      await insertPrincipal(tx, {
        id: input.ownerPrincipalId,
        workspaceId: input.workspaceId,
        type: 'human',
        userId: input.actorUserId,
        displayName: input.ownerDisplayName,
        email: input.ownerEmail,
        now: input.now,
      })
      await tx.execute(sql`
        INSERT INTO workspace_memberships (
          workspace_id, principal_id, role, status, joined_at, updated_at
        ) VALUES (
          ${input.workspaceId}, ${input.ownerPrincipalId}, 'owner', 'active',
          ${new Date(input.now)}, ${new Date(input.now)}
        )
      `)
      await tx.execute(sql`
        UPDATE workspaces
        SET created_by_principal_id = ${input.ownerPrincipalId}
        WHERE id = ${input.workspaceId}
      `)
      const generalChannelId = `channel_general_${input.workspaceId}`
      await tx.execute(sql`
        INSERT INTO conversations (
          id, workspace_id, conversation_type, created_by_principal_id, user_id,
          title, last_modified, updated_at, created_at, last_mode,
          ask_model_ids, act_model_id, channel_slug, channel_visibility, channel_topic
        ) VALUES (
          ${generalChannelId}, ${input.workspaceId}, 'channel', ${input.ownerPrincipalId},
          ${input.actorUserId}, 'general', ${new Date(input.now)}, ${new Date(input.now)},
          ${new Date(input.now)}, 'act', '["moonshotai/kimi-k2.6"]'::jsonb,
          'moonshotai/kimi-k2.6', 'general', 'public',
          'Company-wide announcements and conversation'
        )
      `)
      await tx.execute(sql`
        INSERT INTO conversation_participants (
          conversation_id, workspace_id, principal_id, principal_type,
          role, status, notification_level, joined_at, updated_at, last_read_at
        ) VALUES (
          ${generalChannelId}, ${input.workspaceId}, ${input.ownerPrincipalId}, 'human',
          'moderator', 'active', 'all', ${new Date(input.now)}, ${new Date(input.now)},
          ${new Date(input.now)}
        )
      `)
      await tx.execute(sql`
        INSERT INTO workspace_resource_scopes (
          workspace_id, resource_type, resource_id, created_at, updated_at
        ) VALUES (
          ${input.workspaceId}, 'conversation', ${generalChannelId},
          ${new Date(input.now)}, ${new Date(input.now)}
        )
      `)
      return requiredAccess(await selectAccess(tx, {
        workspaceId: input.workspaceId,
        userId: input.actorUserId,
      }))
    })
  }

  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    const result = await this.db.execute<WorkspaceRow>(sql`
      SELECT ${workspaceColumns} FROM workspaces WHERE id = ${workspaceId} LIMIT 1
    `)
    return result.rows[0] ? workspaceFromRow(result.rows[0]) : null
  }

  async listForUser(
    userId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<WorkspaceAccess[]> {
    const result = await this.db.execute<AccessRow>(sql`
      SELECT ${accessColumns}
      FROM workspaces w
      INNER JOIN workspace_principals p
        ON p.workspace_id = w.id AND p.type = 'human' AND p.user_id = ${userId}
      INNER JOIN workspace_memberships m
        ON m.workspace_id = w.id AND m.principal_id = p.id
      WHERE ${options.includeArchived ? sql`true` : sql`w.status = 'active'`}
      ORDER BY (w.kind = 'personal') DESC, w.name, w.id
    `)
    return result.rows.map(accessFromRow)
  }

  async getAccess(args: { workspaceId: string; userId: string }): Promise<WorkspaceAccess | null> {
    return await selectAccess(this.db, args)
  }

  async getActiveWorkspace(userId: string): Promise<WorkspaceAccess | null> {
    const result = await this.db.execute<AccessRow>(sql`
      SELECT ${accessColumns}
      FROM user_workspace_preferences pref
      INNER JOIN workspaces w ON w.id = pref.active_workspace_id
      INNER JOIN workspace_principals p
        ON p.workspace_id = w.id AND p.type = 'human' AND p.user_id = pref.user_id
      INNER JOIN workspace_memberships m
        ON m.workspace_id = w.id AND m.principal_id = p.id
      WHERE pref.user_id = ${userId}
      LIMIT 1
    `)
    return result.rows[0] ? accessFromRow(result.rows[0]) : null
  }

  async setActiveWorkspace(args: {
    userId: string
    workspaceId: string
    now: number
  }): Promise<WorkspaceAccess | null> {
    const access = await this.getAccess(args)
    if (
      !access
      || access.workspace.status !== 'active'
      || access.membership.status !== 'active'
      || access.principal.archivedAt
    ) return null
    await this.db.execute(sql`
      INSERT INTO user_workspace_preferences (user_id, active_workspace_id, updated_at)
      VALUES (${args.userId}, ${args.workspaceId}, ${new Date(args.now)})
      ON CONFLICT (user_id) DO UPDATE SET
        active_workspace_id = EXCLUDED.active_workspace_id,
        updated_at = EXCLUDED.updated_at
    `)
    return access
  }

  async archiveWorkspace(args: {
    workspaceId: string
    archivedByPrincipalId: string
    now: number
  }): Promise<Workspace | null> {
    const result = await this.db.execute<WorkspaceRow>(sql`
      UPDATE workspaces
      SET status = 'archived',
          archived_at = COALESCE(archived_at, ${new Date(args.now)}),
          updated_at = ${new Date(args.now)}
      WHERE id = ${args.workspaceId} AND kind = 'organization'
      RETURNING ${workspaceColumns}
    `)
    return result.rows[0] ? workspaceFromRow(result.rows[0]) : null
  }

  async createPrincipal(input: CreateWorkspacePrincipalInput): Promise<WorkspacePrincipal> {
    const result = await insertPrincipal(this.db, input)
    return principalFromRow(result)
  }

  async getPrincipal(principalId: string): Promise<WorkspacePrincipal | null> {
    const result = await this.db.execute<PrincipalRow>(sql`
      SELECT ${principalColumns}
      FROM workspace_principals
      WHERE id = ${principalId}
      LIMIT 1
    `)
    return result.rows[0] ? principalFromRow(result.rows[0]) : null
  }

  async getHumanPrincipal(args: {
    workspaceId: string
    userId: string
  }): Promise<WorkspacePrincipal | null> {
    const result = await this.db.execute<PrincipalRow>(sql`
      SELECT ${principalColumns}
      FROM workspace_principals
      WHERE workspace_id = ${args.workspaceId}
        AND type = 'human'
        AND user_id = ${args.userId}
      LIMIT 1
    `)
    return result.rows[0] ? principalFromRow(result.rows[0]) : null
  }

  async listPrincipals(args: {
    workspaceId: string
    includeArchived?: boolean
    type?: WorkspacePrincipal['type']
  }): Promise<WorkspacePrincipal[]> {
    const result = await this.db.execute<PrincipalRow>(sql`
      SELECT ${principalColumns}
      FROM workspace_principals
      WHERE workspace_id = ${args.workspaceId}
        AND ${args.includeArchived ? sql`true` : sql`archived_at IS NULL`}
        AND ${args.type ? sql`type = ${args.type}` : sql`true`}
      ORDER BY display_name, id
    `)
    return result.rows.map(principalFromRow)
  }

  async archivePrincipal(args: { principalId: string; now: number }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE workspace_principals
      SET archived_at = COALESCE(archived_at, ${new Date(args.now)}),
          updated_at = ${new Date(args.now)}
      WHERE id = ${args.principalId} AND archived_at IS NULL
    `)
    return result.rowCount === 1
  }

  async getMembership(args: {
    workspaceId: string
    principalId: string
  }): Promise<WorkspaceMembership | null> {
    const result = await this.db.execute<MembershipRow>(sql`
      SELECT ${membershipColumns}
      FROM workspace_memberships
      WHERE workspace_id = ${args.workspaceId} AND principal_id = ${args.principalId}
      LIMIT 1
    `)
    return result.rows[0] ? membershipFromRow(result.rows[0]) : null
  }

  async listMemberships(args: {
    workspaceId: string
    status?: WorkspaceMembership['status']
  }): Promise<WorkspaceMembership[]> {
    const result = await this.db.execute<MembershipRow>(sql`
      SELECT ${membershipColumns}
      FROM workspace_memberships
      WHERE workspace_id = ${args.workspaceId}
        AND ${args.status ? sql`status = ${args.status}` : sql`true`}
      ORDER BY joined_at, principal_id
    `)
    return result.rows.map(membershipFromRow)
  }

  async setMembershipRole(args: {
    workspaceId: string
    principalId: string
    role: WorkspaceMembership['role']
    now: number
  }): Promise<MembershipMutationResult> {
    return await this.db.transaction(async (tx) => {
      await lockWorkspace(tx, args.workspaceId)
      const current = await selectMembershipForUpdate(tx, args)
      if (!current) return { status: 'not_found' }
      if (args.role === 'owner') {
        const principal = await selectPrincipalForUpdate(tx, args.principalId)
        if (!principal || principal.type !== 'human') return { status: 'owner_must_be_human' }
      }
      if (current.role === 'owner' && current.status === 'active' && args.role !== 'owner') {
        if (await activeOwnerCount(tx, args.workspaceId) <= 1) return { status: 'last_owner' }
      }
      const result = await tx.execute<MembershipRow>(sql`
        UPDATE workspace_memberships
        SET role = ${args.role}, updated_at = ${new Date(args.now)}
        WHERE workspace_id = ${args.workspaceId} AND principal_id = ${args.principalId}
        RETURNING ${membershipColumns}
      `)
      return {
        status: 'updated',
        membership: membershipFromRow(required(result.rows[0], 'set workspace membership role')),
      }
    })
  }

  async setMembershipStatus(args: {
    workspaceId: string
    principalId: string
    status: WorkspaceMembership['status']
    now: number
  }): Promise<MembershipMutationResult> {
    return await this.db.transaction(async (tx) => {
      await lockWorkspace(tx, args.workspaceId)
      const current = await selectMembershipForUpdate(tx, args)
      if (!current) return { status: 'not_found' }
      if (
        current.role === 'owner'
        && current.status === 'active'
        && args.status !== 'active'
        && await activeOwnerCount(tx, args.workspaceId) <= 1
      ) return { status: 'last_owner' }
      const result = await tx.execute<MembershipRow>(sql`
        UPDATE workspace_memberships
        SET status = ${args.status}, updated_at = ${new Date(args.now)}
        WHERE workspace_id = ${args.workspaceId} AND principal_id = ${args.principalId}
        RETURNING ${membershipColumns}
      `)
      return {
        status: 'updated',
        membership: membershipFromRow(required(result.rows[0], 'set workspace membership status')),
      }
    })
  }

  async removeMembership(args: {
    workspaceId: string
    principalId: string
  }): Promise<MembershipRemovalResult> {
    return await this.db.transaction(async (tx) => {
      await lockWorkspace(tx, args.workspaceId)
      const current = await selectMembershipForUpdate(tx, args)
      if (!current) return { status: 'not_found' }
      if (
        current.role === 'owner'
        && current.status === 'active'
        && await activeOwnerCount(tx, args.workspaceId) <= 1
      ) return { status: 'last_owner' }
      await tx.execute(sql`
        DELETE FROM workspace_memberships
        WHERE workspace_id = ${args.workspaceId} AND principal_id = ${args.principalId}
      `)
      return { status: 'removed' }
    })
  }

  async transferOwnership(args: {
    workspaceId: string
    fromPrincipalId: string
    toPrincipalId: string
    now: number
  }): Promise<OwnershipTransferResult> {
    return await this.db.transaction(async (tx) => {
      await lockWorkspace(tx, args.workspaceId)
      // A Drizzle transaction shares one pg client. Issue locking reads
      // sequentially so ownership transfer never overlaps queries on that client.
      const source = await selectMembershipForUpdate(tx, {
        workspaceId: args.workspaceId,
        principalId: args.fromPrincipalId,
      })
      const target = await selectMembershipForUpdate(tx, {
        workspaceId: args.workspaceId,
        principalId: args.toPrincipalId,
      })
      const targetPrincipal = await selectPrincipalForUpdate(tx, args.toPrincipalId)
      if (!source || !target || !targetPrincipal) return { status: 'not_found' }
      if (source.role !== 'owner' || source.status !== 'active') return { status: 'source_not_owner' }
      if (targetPrincipal.type !== 'human') return { status: 'target_not_human' }
      if (target.status !== 'active') return { status: 'target_inactive' }

      const targetResult = await tx.execute<MembershipRow>(sql`
        UPDATE workspace_memberships
        SET role = 'owner', updated_at = ${new Date(args.now)}
        WHERE workspace_id = ${args.workspaceId} AND principal_id = ${args.toPrincipalId}
        RETURNING ${membershipColumns}
      `)
      const sourceResult = await tx.execute<MembershipRow>(sql`
        UPDATE workspace_memberships
        SET role = 'admin', updated_at = ${new Date(args.now)}
        WHERE workspace_id = ${args.workspaceId} AND principal_id = ${args.fromPrincipalId}
        RETURNING ${membershipColumns}
      `)
      return {
        status: 'transferred',
        previousOwnerMembership: membershipFromRow(required(
          sourceResult.rows[0],
          'demote previous workspace owner',
        )),
        newOwnerMembership: membershipFromRow(required(
          targetResult.rows[0],
          'promote new workspace owner',
        )),
      }
    })
  }

  async createTeam(input: {
    id: string
    workspaceId: string
    name: string
    description?: string
    createdByPrincipalId: string
    now: number
  }): Promise<WorkspaceTeam> {
    const result = await this.db.execute<TeamRow>(sql`
      INSERT INTO workspace_teams (
        id, workspace_id, name, description, created_by_principal_id, created_at, updated_at
      ) VALUES (
        ${input.id}, ${input.workspaceId}, ${input.name}, ${input.description ?? null},
        ${input.createdByPrincipalId}, ${new Date(input.now)}, ${new Date(input.now)}
      )
      RETURNING ${teamColumns}
    `)
    return teamFromRow(required(result.rows[0], 'create workspace team'))
  }

  async getTeam(teamId: string): Promise<WorkspaceTeam | null> {
    const result = await this.db.execute<TeamRow>(sql`
      SELECT ${teamColumns} FROM workspace_teams WHERE id = ${teamId} LIMIT 1
    `)
    return result.rows[0] ? teamFromRow(result.rows[0]) : null
  }

  async listTeams(args: {
    workspaceId: string
    includeArchived?: boolean
  }): Promise<WorkspaceTeam[]> {
    const result = await this.db.execute<TeamRow>(sql`
      SELECT ${teamColumns}
      FROM workspace_teams
      WHERE workspace_id = ${args.workspaceId}
        AND ${args.includeArchived ? sql`true` : sql`archived_at IS NULL`}
      ORDER BY name, id
    `)
    return result.rows.map(teamFromRow)
  }

  async archiveTeam(args: { teamId: string; now: number }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE workspace_teams
      SET archived_at = COALESCE(archived_at, ${new Date(args.now)}),
          updated_at = ${new Date(args.now)}
      WHERE id = ${args.teamId} AND archived_at IS NULL
    `)
    return result.rowCount === 1
  }

  async addTeamMember(input: {
    teamId: string
    workspaceId: string
    principalId: string
    principalType: WorkspaceTeamMember['principalType']
    addedByPrincipalId?: string
    now: number
  }): Promise<WorkspaceTeamMember> {
    const result = await this.db.execute<TeamMemberRow>(sql`
      INSERT INTO workspace_team_members (
        team_id, workspace_id, principal_id, principal_type, added_by_principal_id, created_at
      ) VALUES (
        ${input.teamId}, ${input.workspaceId}, ${input.principalId}, ${input.principalType},
        ${input.addedByPrincipalId ?? null}, ${new Date(input.now)}
      )
      ON CONFLICT (team_id, principal_id) DO UPDATE SET
        added_by_principal_id = EXCLUDED.added_by_principal_id
      RETURNING ${teamMemberColumns}
    `)
    return teamMemberFromRow(required(result.rows[0], 'add workspace team member'))
  }

  async removeTeamMember(args: { teamId: string; principalId: string }): Promise<boolean> {
    const result = await this.db.execute(sql`
      DELETE FROM workspace_team_members
      WHERE team_id = ${args.teamId} AND principal_id = ${args.principalId}
    `)
    return result.rowCount === 1
  }

  async listTeamMembers(teamId: string): Promise<WorkspaceTeamMember[]> {
    const result = await this.db.execute<TeamMemberRow>(sql`
      SELECT ${teamMemberColumns}
      FROM workspace_team_members
      WHERE team_id = ${teamId}
      ORDER BY created_at, principal_id
    `)
    return result.rows.map(teamMemberFromRow)
  }

  async createInvitationReplacingPending(
    input: CreateWorkspaceInvitationInput,
  ): Promise<WorkspaceInvitation> {
    return await this.db.transaction(async (tx) => {
      await lockWorkspace(tx, input.workspaceId)
      const pending = await tx.execute<{ id: string }>(sql`
        SELECT id
        FROM workspace_invitations
        WHERE workspace_id = ${input.workspaceId}
          AND lower(email) = lower(${input.email})
          AND status = 'pending'
        FOR UPDATE
      `)
      const replacedId = pending.rows[0]?.id
      if (replacedId) {
        await tx.execute(sql`
          UPDATE workspace_invitations
          SET status = 'replaced',
              replaced_at = ${new Date(input.now)},
              updated_at = ${new Date(input.now)}
          WHERE id = ${replacedId}
        `)
      }
      const created = await tx.execute<InvitationRow>(sql`
        INSERT INTO workspace_invitations (
          id, workspace_id, email, role, status, invited_by_principal_id,
          expires_at, created_at, updated_at
        ) VALUES (
          ${input.id}, ${input.workspaceId}, lower(${input.email}), ${input.role}, 'pending',
          ${input.invitedByPrincipalId}, ${new Date(input.expiresAt)},
          ${new Date(input.now)}, ${new Date(input.now)}
        )
        RETURNING ${invitationColumns}
      `)
      if (replacedId) {
        await tx.execute(sql`
          UPDATE workspace_invitations
          SET replaced_by_invitation_id = ${input.id}
          WHERE id = ${replacedId}
        `)
      }
      return invitationFromRow(required(created.rows[0], 'create workspace invitation'))
    })
  }

  async getInvitation(invitationId: string): Promise<WorkspaceInvitation | null> {
    const result = await this.db.execute<InvitationRow>(sql`
      SELECT ${invitationColumns}
      FROM workspace_invitations
      WHERE id = ${invitationId}
      LIMIT 1
    `)
    return result.rows[0] ? invitationFromRow(result.rows[0]) : null
  }

  async listInvitations(args: {
    workspaceId: string
    status?: WorkspaceInvitation['status']
  }): Promise<WorkspaceInvitation[]> {
    const result = await this.db.execute<InvitationRow>(sql`
      SELECT ${invitationColumns}
      FROM workspace_invitations
      WHERE workspace_id = ${args.workspaceId}
        AND ${args.status ? sql`status = ${args.status}` : sql`true`}
      ORDER BY created_at DESC, id
    `)
    return result.rows.map(invitationFromRow)
  }

  async acceptInvitation(
    input: AcceptWorkspaceInvitationInput,
  ): Promise<InvitationAcceptanceResult> {
    return await this.db.transaction(async (tx) => {
      const result = await tx.execute<InvitationRow>(sql`
        SELECT ${invitationColumns}
        FROM workspace_invitations
        WHERE id = ${input.invitationId}
        FOR UPDATE
      `)
      const row = result.rows[0]
      if (!row) return { status: 'not_found' }
      if (row.status !== 'pending') return { status: 'not_pending' }
      if (millisRequired(row.expiresAt) <= input.now) {
        await tx.execute(sql`
          UPDATE workspace_invitations
          SET status = 'expired', updated_at = ${new Date(input.now)}
          WHERE id = ${input.invitationId}
        `)
        return { status: 'expired' }
      }
      if (row.email.toLowerCase() !== input.email.toLowerCase()) {
        return { status: 'email_mismatch' }
      }

      await lockWorkspace(tx, row.workspaceId)
      const existing = await tx.execute<PrincipalRow>(sql`
        SELECT ${principalColumns}
        FROM workspace_principals
        WHERE workspace_id = ${row.workspaceId}
          AND type = 'human'
          AND user_id = ${input.userId}
        FOR UPDATE
      `)
      let principal: WorkspacePrincipal
      if (existing.rows[0]) {
        principal = principalFromRow(existing.rows[0])
        if (principal.archivedAt) {
          const restored = await tx.execute<PrincipalRow>(sql`
            UPDATE workspace_principals
            SET archived_at = NULL,
                display_name = ${input.displayName},
                email = lower(${input.email}),
                updated_at = ${new Date(input.now)}
            WHERE id = ${principal.id}
            RETURNING ${principalColumns}
          `)
          principal = principalFromRow(required(restored.rows[0], 'restore invited principal'))
        }
      } else {
        principal = principalFromRow(await insertPrincipal(tx, {
          id: input.principalId,
          workspaceId: row.workspaceId,
          type: 'human',
          userId: input.userId,
          displayName: input.displayName,
          email: input.email,
          createdByPrincipalId: row.invitedByPrincipalId,
          now: input.now,
        }))
      }

      await tx.execute(sql`
        INSERT INTO workspace_memberships (
          workspace_id, principal_id, role, status, invited_by_principal_id, joined_at, updated_at
        ) VALUES (
          ${row.workspaceId}, ${principal.id}, ${row.role}, 'active',
          ${row.invitedByPrincipalId}, ${new Date(input.now)}, ${new Date(input.now)}
        )
        ON CONFLICT (workspace_id, principal_id) DO UPDATE SET
          role = CASE
            WHEN workspace_memberships.role IN ('owner', 'admin') THEN workspace_memberships.role
            WHEN workspace_memberships.role = 'member' AND EXCLUDED.role = 'guest'
              THEN workspace_memberships.role
            ELSE EXCLUDED.role
          END,
          status = 'active',
          invited_by_principal_id = EXCLUDED.invited_by_principal_id,
          updated_at = EXCLUDED.updated_at
      `)
      await tx.execute(sql`
        INSERT INTO conversation_participants (
          conversation_id, workspace_id, principal_id, principal_type,
          role, status, notification_level, joined_at, updated_at
        )
        SELECT
          channel.id, channel.workspace_id, ${principal.id}, 'human',
          (CASE WHEN ${row.role} IN ('owner', 'admin') THEN 'moderator'
               ELSE 'member' END)::overlay_conversation_participant_role,
          'active', 'all', ${new Date(input.now)}, ${new Date(input.now)}
        FROM conversations channel
        WHERE channel.workspace_id = ${row.workspaceId}
          AND channel.conversation_type = 'channel'
          AND channel.channel_visibility = 'public'
          AND channel.deleted_at IS NULL
        ON CONFLICT (conversation_id, principal_id) DO UPDATE SET
          status = 'active', removed_at = NULL, archived_at = NULL, updated_at = EXCLUDED.updated_at
      `)
      const accepted = await tx.execute<InvitationRow>(sql`
        UPDATE workspace_invitations
        SET status = 'accepted',
            accepted_by_principal_id = ${principal.id},
            accepted_at = ${new Date(input.now)},
            updated_at = ${new Date(input.now)}
        WHERE id = ${input.invitationId} AND status = 'pending'
        RETURNING ${invitationColumns}
      `)
      const access = requiredAccess(await selectAccess(tx, {
        workspaceId: row.workspaceId,
        userId: input.userId,
      }))
      return {
        status: 'accepted',
        access,
        invitation: invitationFromRow(required(accepted.rows[0], 'accept workspace invitation')),
      }
    })
  }

  async cancelInvitation(args: {
    invitationId: string
    cancelledByPrincipalId: string
    now: number
  }): Promise<WorkspaceInvitation | null> {
    const result = await this.db.execute<InvitationRow>(sql`
      UPDATE workspace_invitations
      SET status = 'cancelled',
          cancelled_at = ${new Date(args.now)},
          updated_at = ${new Date(args.now)}
      WHERE id = ${args.invitationId}
        AND status = 'pending'
        AND invited_by_principal_id IS NOT NULL
      RETURNING ${invitationColumns}
    `)
    return result.rows[0] ? invitationFromRow(result.rows[0]) : null
  }

  async expireInvitations(args: { workspaceId?: string; now: number }): Promise<number> {
    const result = await this.db.execute(sql`
      UPDATE workspace_invitations
      SET status = 'expired', updated_at = ${new Date(args.now)}
      WHERE status = 'pending'
        AND expires_at <= ${new Date(args.now)}
        AND ${args.workspaceId ? sql`workspace_id = ${args.workspaceId}` : sql`true`}
    `)
    return result.rowCount ?? 0
  }

  async bindResource(input: {
    workspaceId: string
    resourceType: string
    resourceId: string
    now: number
  }): Promise<WorkspaceResourceScope> {
    const result = await this.db.execute<ResourceScopeRow>(sql`
      INSERT INTO workspace_resource_scopes (
        workspace_id, resource_type, resource_id, created_at, updated_at
      ) VALUES (
        ${input.workspaceId}, ${input.resourceType}, ${input.resourceId},
        ${new Date(input.now)}, ${new Date(input.now)}
      )
      ON CONFLICT (resource_type, resource_id) DO UPDATE
      SET updated_at = EXCLUDED.updated_at
      WHERE workspace_resource_scopes.workspace_id = EXCLUDED.workspace_id
      RETURNING ${resourceScopeColumns}
    `)
    const row = result.rows[0]
    if (!row) throw new Error('Resource is already bound to another workspace')
    return resourceScopeFromRow(row)
  }

  async getResourceWorkspace(args: {
    resourceType: string
    resourceId: string
  }): Promise<WorkspaceResourceScope | null> {
    const result = await this.db.execute<ResourceScopeRow>(sql`
      SELECT ${resourceScopeColumns}
      FROM workspace_resource_scopes
      WHERE resource_type = ${args.resourceType}
        AND resource_id = ${args.resourceId}
      LIMIT 1
    `)
    return result.rows[0] ? resourceScopeFromRow(result.rows[0]) : null
  }

  async listResourceIdsByWorkspace(args: {
    workspaceId: string
    resourceType: string
  }): Promise<string[]> {
    const result = await this.db.execute<{ resource_id: string }>(sql`
      SELECT resource_id
      FROM workspace_resource_scopes
      WHERE workspace_id = ${args.workspaceId}
        AND resource_type = ${args.resourceType}
    `)
    return result.rows.map((row) => row.resource_id)
  }

  async getSharingPolicy(workspaceId: string): Promise<WorkspaceSharingPolicy | null> {
    const result = await this.db.execute<SharingPolicyRow>(sql`
      SELECT ${sharingPolicyColumns}
      FROM workspace_sharing_policies
      WHERE workspace_id = ${workspaceId}
      LIMIT 1
    `)
    return result.rows[0] ? sharingPolicyFromRow(result.rows[0]) : null
  }

  async setSharingPolicy(input: SetWorkspaceSharingPolicyInput): Promise<WorkspaceSharingPolicy> {
    // COALESCE keeps every unspecified field at its stored value, so a patch of
    // one policy field never silently resets the others.
    const result = await this.db.execute<SharingPolicyRow>(sql`
      INSERT INTO workspace_sharing_policies (
        workspace_id, public_links_enabled, member_can_create_channels,
        member_can_create_agents, member_can_invite, guest_expiration_days,
        allowed_agent_harnesses, agent_run_budget_cents, channel_retention_days,
        legal_hold, data_residency, rollout_stage,
        updated_by_principal_id, created_at, updated_at
      ) VALUES (
        ${input.workspaceId},
        ${input.patch.publicLinksEnabled ?? true},
        ${input.patch.memberCanCreateChannels ?? true},
        ${input.patch.memberCanCreateAgents ?? true},
        ${input.patch.memberCanInvite ?? false},
        ${input.patch.guestExpirationDays ?? null},
        ${input.patch.allowedAgentHarnesses ? textArray(input.patch.allowedAgentHarnesses) : sql`NULL`},
        ${input.patch.agentRunBudgetCents ?? null},
        ${input.patch.channelRetentionDays ?? null},
        ${input.patch.legalHold ?? false},
        ${input.patch.dataResidency ?? null},
        ${input.patch.rolloutStage ?? 'general'},
        ${input.updatedByPrincipalId}, ${new Date(input.now)}, ${new Date(input.now)}
      )
      ON CONFLICT (workspace_id) DO UPDATE SET
        public_links_enabled = COALESCE(${input.patch.publicLinksEnabled ?? null}, workspace_sharing_policies.public_links_enabled),
        member_can_create_channels = COALESCE(${input.patch.memberCanCreateChannels ?? null}, workspace_sharing_policies.member_can_create_channels),
        member_can_create_agents = COALESCE(${input.patch.memberCanCreateAgents ?? null}, workspace_sharing_policies.member_can_create_agents),
        member_can_invite = COALESCE(${input.patch.memberCanInvite ?? null}, workspace_sharing_policies.member_can_invite),
        guest_expiration_days = ${'guestExpirationDays' in input.patch ? sql`${input.patch.guestExpirationDays ?? null}` : sql`workspace_sharing_policies.guest_expiration_days`},
        allowed_agent_harnesses = ${'allowedAgentHarnesses' in input.patch
          ? (input.patch.allowedAgentHarnesses ? textArray(input.patch.allowedAgentHarnesses) : sql`NULL`)
          : sql`workspace_sharing_policies.allowed_agent_harnesses`},
        agent_run_budget_cents = ${'agentRunBudgetCents' in input.patch ? sql`${input.patch.agentRunBudgetCents ?? null}` : sql`workspace_sharing_policies.agent_run_budget_cents`},
        channel_retention_days = ${'channelRetentionDays' in input.patch ? sql`${input.patch.channelRetentionDays ?? null}` : sql`workspace_sharing_policies.channel_retention_days`},
        legal_hold = COALESCE(${input.patch.legalHold ?? null}, workspace_sharing_policies.legal_hold),
        data_residency = ${'dataResidency' in input.patch ? sql`${input.patch.dataResidency ?? null}` : sql`workspace_sharing_policies.data_residency`},
        rollout_stage = COALESCE(${input.patch.rolloutStage ?? null}, workspace_sharing_policies.rollout_stage),
        updated_by_principal_id = excluded.updated_by_principal_id,
        updated_at = excluded.updated_at
      RETURNING ${sharingPolicyColumns}
    `)
    const row = result.rows[0]
    if (!row) throw new Error('WORKSPACE_SHARING_POLICY_UPSERT_FAILED')
    return sharingPolicyFromRow(row)
  }

  async upsertIdentityMapping(
    input: Parameters<WorkspaceRepository['upsertIdentityMapping']>[0],
  ): Promise<WorkspaceIdentityMapping> {
    const result = await this.db.execute<IdentityMappingRow>(sql`
      INSERT INTO workspace_identity_mappings (
        id, workspace_id, principal_id, directory, external_id, external_group_ids,
        status, created_at, updated_at
      ) VALUES (
        ${input.id}, ${input.workspaceId}, ${input.principalId}, ${input.directory},
        ${input.externalId}, ${textArray(input.externalGroupIds)}, 'active',
        ${new Date(input.now)}, ${new Date(input.now)}
      )
      ON CONFLICT (workspace_id, directory, external_id) DO UPDATE SET
        principal_id = excluded.principal_id,
        external_group_ids = excluded.external_group_ids,
        status = 'active',
        deprovisioned_at = NULL,
        updated_at = excluded.updated_at
      RETURNING ${identityMappingColumns}
    `)
    const row = result.rows[0]
    if (!row) throw new Error('WORKSPACE_IDENTITY_MAPPING_UPSERT_FAILED')
    return identityMappingFromRow(row)
  }

  async getIdentityMapping(
    args: Parameters<WorkspaceRepository['getIdentityMapping']>[0],
  ): Promise<WorkspaceIdentityMapping | null> {
    const result = await this.db.execute<IdentityMappingRow>(sql`
      SELECT ${identityMappingColumns}
      FROM workspace_identity_mappings
      WHERE workspace_id = ${args.workspaceId}
        AND directory = ${args.directory}
        AND external_id = ${args.externalId}
      LIMIT 1
    `)
    return result.rows[0] ? identityMappingFromRow(result.rows[0]) : null
  }

  async listIdentityMappings(
    args: Parameters<WorkspaceRepository['listIdentityMappings']>[0],
  ): Promise<WorkspaceIdentityMapping[]> {
    const result = await this.db.execute<IdentityMappingRow>(sql`
      SELECT ${identityMappingColumns}
      FROM workspace_identity_mappings
      WHERE workspace_id = ${args.workspaceId}
        ${args.includeDeprovisioned ? sql`` : sql`AND status = 'active'`}
      ORDER BY created_at, id
    `)
    return result.rows.map(identityMappingFromRow)
  }

  async deprovisionIdentityMapping(
    args: Parameters<WorkspaceRepository['deprovisionIdentityMapping']>[0],
  ): Promise<WorkspaceIdentityMapping | null> {
    const result = await this.db.execute<IdentityMappingRow>(sql`
      UPDATE workspace_identity_mappings
      SET status = 'deprovisioned', deprovisioned_at = ${new Date(args.now)},
          updated_at = ${new Date(args.now)}
      WHERE workspace_id = ${args.workspaceId}
        AND directory = ${args.directory}
        AND external_id = ${args.externalId}
        AND status = 'active'
      RETURNING ${identityMappingColumns}
    `)
    return result.rows[0] ? identityMappingFromRow(result.rows[0]) : null
  }

  async recordAuditExport(
    input: Parameters<WorkspaceRepository['recordAuditExport']>[0],
  ): Promise<WorkspaceAuditExportRecord> {
    const result = await this.db.execute<AuditExportRow>(sql`
      INSERT INTO workspace_audit_exports (
        id, workspace_id, requested_by_principal_id, from_recorded_at, to_recorded_at,
        event_count, created_at
      ) VALUES (
        ${input.id}, ${input.workspaceId}, ${input.requestedByPrincipalId},
        ${dateOrNull(input.fromRecordedAt)}, ${new Date(input.toRecordedAt)},
        ${input.eventCount}, ${new Date(input.now)}
      )
      RETURNING ${auditExportColumns}
    `)
    const row = result.rows[0]
    if (!row) throw new Error('WORKSPACE_AUDIT_EXPORT_RECORD_FAILED')
    return auditExportFromRow(row)
  }

  async listAuditExports(
    args: Parameters<WorkspaceRepository['listAuditExports']>[0],
  ): Promise<WorkspaceAuditExportRecord[]> {
    const result = await this.db.execute<AuditExportRow>(sql`
      SELECT ${auditExportColumns}
      FROM workspace_audit_exports
      WHERE workspace_id = ${args.workspaceId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${args.limit ?? 50}
    `)
    return result.rows.map(auditExportFromRow)
  }

  async createResourceGuest(input: {
    id: string
    workspaceId: string
    resourceType: string
    resourceId: string
    principalId: string
    accessRole: WorkspaceResourceGuest['accessRole']
    status?: WorkspaceResourceGuest['status']
    grantedByPrincipalId: string
    expiresAt?: number
    now: number
  }): Promise<WorkspaceResourceGuest> {
    return await this.db.transaction(async (tx) => {
      await lockWorkspace(tx, input.workspaceId)
      const existing = await tx.execute<GuestRow>(sql`
        SELECT ${guestColumns}
        FROM workspace_resource_guests
        WHERE workspace_id = ${input.workspaceId}
          AND resource_type = ${input.resourceType}
          AND resource_id = ${input.resourceId}
          AND principal_id = ${input.principalId}
          AND status IN ('pending', 'active')
        FOR UPDATE
      `)
      if (existing.rows[0]) {
        const updated = await tx.execute<GuestRow>(sql`
          UPDATE workspace_resource_guests
          SET access_role = ${input.accessRole},
              status = ${input.status ?? 'pending'},
              granted_by_principal_id = ${input.grantedByPrincipalId},
              expires_at = ${dateOrNull(input.expiresAt)},
              updated_at = ${new Date(input.now)}
          WHERE id = ${existing.rows[0].id}
          RETURNING ${guestColumns}
        `)
        return guestFromRow(required(updated.rows[0], 'update workspace resource guest'))
      }
      const result = await tx.execute<GuestRow>(sql`
        INSERT INTO workspace_resource_guests (
          id, workspace_id, resource_type, resource_id, principal_id, access_role,
          status, granted_by_principal_id, expires_at, created_at, updated_at
        ) VALUES (
          ${input.id}, ${input.workspaceId}, ${input.resourceType}, ${input.resourceId},
          ${input.principalId}, ${input.accessRole}, ${input.status ?? 'pending'},
          ${input.grantedByPrincipalId}, ${dateOrNull(input.expiresAt)},
          ${new Date(input.now)}, ${new Date(input.now)}
        )
        RETURNING ${guestColumns}
      `)
      return guestFromRow(required(result.rows[0], 'create workspace resource guest'))
    })
  }

  async listResourceGuests(args: {
    workspaceId: string
    resourceType?: string
    resourceId?: string
    includeInactive?: boolean
  }): Promise<WorkspaceResourceGuest[]> {
    const result = await this.db.execute<GuestRow>(sql`
      SELECT ${guestColumns}
      FROM workspace_resource_guests
      WHERE workspace_id = ${args.workspaceId}
        AND ${args.resourceType ? sql`resource_type = ${args.resourceType}` : sql`true`}
        AND ${args.resourceId ? sql`resource_id = ${args.resourceId}` : sql`true`}
        AND ${args.includeInactive ? sql`true` : sql`status IN ('pending', 'active')`}
      ORDER BY created_at DESC, id
    `)
    return result.rows.map(guestFromRow)
  }

  async revokeResourceGuest(args: {
    id: string
    revokedByPrincipalId: string
    now: number
  }): Promise<WorkspaceResourceGuest | null> {
    const result = await this.db.execute<GuestRow>(sql`
      UPDATE workspace_resource_guests
      SET status = 'revoked',
          revoked_at = ${new Date(args.now)},
          updated_at = ${new Date(args.now)}
      WHERE id = ${args.id} AND status IN ('pending', 'active')
      RETURNING ${guestColumns}
    `)
    return result.rows[0] ? guestFromRow(result.rows[0]) : null
  }
}

const workspaceColumns = sql.raw(`
  id, kind, name, slug, status,
  created_by_principal_id AS "createdByPrincipalId",
  created_at AS "createdAt", updated_at AS "updatedAt", archived_at AS "archivedAt"
`)
const resourceScopeColumns = sql.raw(`
  workspace_id AS "workspaceId", resource_type AS "resourceType",
  resource_id AS "resourceId", created_at AS "createdAt", updated_at AS "updatedAt"
`)
const sharingPolicyColumns = sql.raw(`
  workspace_id AS "workspaceId", public_links_enabled AS "publicLinksEnabled",
  member_can_create_channels AS "memberCanCreateChannels",
  member_can_create_agents AS "memberCanCreateAgents",
  member_can_invite AS "memberCanInvite",
  guest_expiration_days AS "guestExpirationDays",
  allowed_agent_harnesses AS "allowedAgentHarnesses",
  agent_run_budget_cents AS "agentRunBudgetCents",
  channel_retention_days AS "channelRetentionDays",
  legal_hold AS "legalHold", data_residency AS "dataResidency",
  rollout_stage AS "rolloutStage",
  updated_by_principal_id AS "updatedByPrincipalId", updated_at AS "updatedAt"
`)
const identityMappingColumns = sql.raw(`
  id, workspace_id AS "workspaceId", principal_id AS "principalId", directory,
  external_id AS "externalId", external_group_ids AS "externalGroupIds", status,
  created_at AS "createdAt", updated_at AS "updatedAt",
  deprovisioned_at AS "deprovisionedAt"
`)
const auditExportColumns = sql.raw(`
  id, workspace_id AS "workspaceId",
  requested_by_principal_id AS "requestedByPrincipalId",
  from_recorded_at AS "fromRecordedAt", to_recorded_at AS "toRecordedAt",
  event_count AS "eventCount", created_at AS "createdAt"
`)
const principalColumns = sql.raw(`
  id, workspace_id AS "workspaceId", type,
  user_id AS "userId", agent_id AS "agentId", service_id AS "serviceId",
  display_name AS "displayName", email,
  created_by_principal_id AS "createdByPrincipalId",
  created_at AS "createdAt", updated_at AS "updatedAt", archived_at AS "archivedAt"
`)
const membershipColumns = sql.raw(`
  workspace_id AS "workspaceId", principal_id AS "principalId", role, status,
  invited_by_principal_id AS "invitedByPrincipalId",
  joined_at AS "joinedAt", updated_at AS "updatedAt"
`)
const accessColumns = sql.raw(`
  row_to_json((
    SELECT workspace_row FROM (
      SELECT w.id, w.kind, w.name, w.slug, w.status,
        w.created_by_principal_id AS "createdByPrincipalId",
        w.created_at AS "createdAt", w.updated_at AS "updatedAt", w.archived_at AS "archivedAt"
    ) workspace_row
  )) AS workspace,
  row_to_json((
    SELECT principal_row FROM (
      SELECT p.id, p.workspace_id AS "workspaceId", p.type,
        p.user_id AS "userId", p.agent_id AS "agentId", p.service_id AS "serviceId",
        p.display_name AS "displayName", p.email,
        p.created_by_principal_id AS "createdByPrincipalId",
        p.created_at AS "createdAt", p.updated_at AS "updatedAt", p.archived_at AS "archivedAt"
    ) principal_row
  )) AS principal,
  row_to_json((
    SELECT membership_row FROM (
      SELECT m.workspace_id AS "workspaceId", m.principal_id AS "principalId",
        m.role, m.status, m.invited_by_principal_id AS "invitedByPrincipalId",
        m.joined_at AS "joinedAt", m.updated_at AS "updatedAt"
    ) membership_row
  )) AS membership
`)
const teamColumns = sql.raw(`
  id, workspace_id AS "workspaceId", name, description,
  created_by_principal_id AS "createdByPrincipalId",
  created_at AS "createdAt", updated_at AS "updatedAt", archived_at AS "archivedAt"
`)
const teamMemberColumns = sql.raw(`
  team_id AS "teamId", workspace_id AS "workspaceId", principal_id AS "principalId",
  principal_type AS "principalType", added_by_principal_id AS "addedByPrincipalId",
  created_at AS "createdAt"
`)
const invitationColumns = sql.raw(`
  id, workspace_id AS "workspaceId", email, role, status,
  invited_by_principal_id AS "invitedByPrincipalId",
  accepted_by_principal_id AS "acceptedByPrincipalId",
  replaced_by_invitation_id AS "replacedByInvitationId",
  expires_at AS "expiresAt", created_at AS "createdAt", updated_at AS "updatedAt",
  accepted_at AS "acceptedAt", cancelled_at AS "cancelledAt", replaced_at AS "replacedAt"
`)
const guestColumns = sql.raw(`
  id, workspace_id AS "workspaceId", resource_type AS "resourceType",
  resource_id AS "resourceId", principal_id AS "principalId",
  access_role AS "accessRole", status,
  granted_by_principal_id AS "grantedByPrincipalId",
  expires_at AS "expiresAt", created_at AS "createdAt", updated_at AS "updatedAt",
  revoked_at AS "revokedAt"
`)

async function selectAccess(
  db: Pick<OverlayPostgresDb, 'execute'>,
  args: { userId: string; workspaceId?: string; personalOnly?: boolean },
): Promise<WorkspaceAccess | null> {
  const result = await db.execute<AccessRow>(sql`
    SELECT ${accessColumns}
    FROM workspaces w
    INNER JOIN workspace_principals p
      ON p.workspace_id = w.id AND p.type = 'human' AND p.user_id = ${args.userId}
    INNER JOIN workspace_memberships m
      ON m.workspace_id = w.id AND m.principal_id = p.id
    WHERE ${args.workspaceId ? sql`w.id = ${args.workspaceId}` : sql`true`}
      AND ${args.personalOnly ? sql`w.kind = 'personal'` : sql`true`}
    ORDER BY w.created_at
    LIMIT 1
  `)
  return result.rows[0] ? accessFromRow(result.rows[0]) : null
}

async function insertPrincipal(
  db: Pick<OverlayPostgresDb, 'execute'>,
  input: CreateWorkspacePrincipalInput,
): Promise<PrincipalRow> {
  const result = await db.execute<PrincipalRow>(sql`
    INSERT INTO workspace_principals (
      id, workspace_id, type, user_id, agent_id, service_id, display_name, email,
      created_by_principal_id, created_at, updated_at
    ) VALUES (
      ${input.id}, ${input.workspaceId}, ${input.type}, ${input.userId ?? null},
      ${input.agentId ?? null}, ${input.serviceId ?? null}, ${input.displayName},
      ${input.email?.toLowerCase() ?? null}, ${input.createdByPrincipalId ?? null},
      ${new Date(input.now)}, ${new Date(input.now)}
    )
    RETURNING ${principalColumns}
  `)
  return required(result.rows[0], 'create workspace principal')
}

async function selectMembershipForUpdate(
  db: Pick<OverlayPostgresDb, 'execute'>,
  args: { workspaceId: string; principalId: string },
): Promise<WorkspaceMembership | null> {
  const result = await db.execute<MembershipRow>(sql`
    SELECT ${membershipColumns}
    FROM workspace_memberships
    WHERE workspace_id = ${args.workspaceId} AND principal_id = ${args.principalId}
    FOR UPDATE
  `)
  return result.rows[0] ? membershipFromRow(result.rows[0]) : null
}

async function selectPrincipalForUpdate(
  db: Pick<OverlayPostgresDb, 'execute'>,
  principalId: string,
): Promise<WorkspacePrincipal | null> {
  const result = await db.execute<PrincipalRow>(sql`
    SELECT ${principalColumns}
    FROM workspace_principals
    WHERE id = ${principalId}
    FOR UPDATE
  `)
  return result.rows[0] ? principalFromRow(result.rows[0]) : null
}

async function lockWorkspace(
  db: Pick<OverlayPostgresDb, 'execute'>,
  workspaceId: string,
): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId}, 0))`)
}

async function activeOwnerCount(
  db: Pick<OverlayPostgresDb, 'execute'>,
  workspaceId: string,
): Promise<number> {
  const result = await db.execute<{ count: number | string }>(sql`
    SELECT count(*)::int AS count
    FROM workspace_memberships
    WHERE workspace_id = ${workspaceId} AND role = 'owner' AND status = 'active'
  `)
  return Number(result.rows[0]?.count ?? 0)
}

function workspaceFromRow(row: WorkspaceRow): Workspace {
  return {
    ...row,
    createdByPrincipalId: row.createdByPrincipalId ?? undefined,
    createdAt: millisRequired(row.createdAt),
    updatedAt: millisRequired(row.updatedAt),
    archivedAt: millis(row.archivedAt),
  }
}

function principalFromRow(row: PrincipalRow): WorkspacePrincipal {
  return {
    ...row,
    userId: row.userId ?? undefined,
    agentId: row.agentId ?? undefined,
    serviceId: row.serviceId ?? undefined,
    email: row.email ?? undefined,
    createdByPrincipalId: row.createdByPrincipalId ?? undefined,
    createdAt: millisRequired(row.createdAt),
    updatedAt: millisRequired(row.updatedAt),
    archivedAt: millis(row.archivedAt),
  }
}

function membershipFromRow(row: MembershipRow): WorkspaceMembership {
  return {
    ...row,
    invitedByPrincipalId: row.invitedByPrincipalId ?? undefined,
    joinedAt: millisRequired(row.joinedAt),
    updatedAt: millisRequired(row.updatedAt),
  }
}

function accessFromRow(row: AccessRow): WorkspaceAccess {
  return {
    workspace: workspaceFromRow(row.workspace),
    principal: principalFromRow(row.principal),
    membership: membershipFromRow(row.membership),
  }
}

function teamFromRow(row: TeamRow): WorkspaceTeam {
  return {
    ...row,
    description: row.description ?? undefined,
    createdAt: millisRequired(row.createdAt),
    updatedAt: millisRequired(row.updatedAt),
    archivedAt: millis(row.archivedAt),
  }
}

function teamMemberFromRow(row: TeamMemberRow): WorkspaceTeamMember {
  return {
    ...row,
    addedByPrincipalId: row.addedByPrincipalId ?? undefined,
    createdAt: millisRequired(row.createdAt),
  }
}

function invitationFromRow(row: InvitationRow): WorkspaceInvitation {
  return {
    ...row,
    acceptedByPrincipalId: row.acceptedByPrincipalId ?? undefined,
    replacedByInvitationId: row.replacedByInvitationId ?? undefined,
    expiresAt: millisRequired(row.expiresAt),
    createdAt: millisRequired(row.createdAt),
    updatedAt: millisRequired(row.updatedAt),
    acceptedAt: millis(row.acceptedAt),
    cancelledAt: millis(row.cancelledAt),
    replacedAt: millis(row.replacedAt),
  }
}

function guestFromRow(row: GuestRow): WorkspaceResourceGuest {
  return {
    ...row,
    expiresAt: millis(row.expiresAt),
    createdAt: millisRequired(row.createdAt),
    updatedAt: millisRequired(row.updatedAt),
    revokedAt: millis(row.revokedAt),
  }
}

function resourceScopeFromRow(row: ResourceScopeRow): WorkspaceResourceScope {
  return {
    ...row,
    createdAt: millisRequired(row.createdAt),
    updatedAt: millisRequired(row.updatedAt),
  }
}

/** Postgres text[] literals: an empty list must still be typed. */
function textArray(values: readonly string[] | undefined) {
  if (!values?.length) return sql`'{}'::text[]`
  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`
}

function identityMappingFromRow(row: IdentityMappingRow): WorkspaceIdentityMapping {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    principalId: row.principalId,
    directory: row.directory,
    externalId: row.externalId,
    externalGroupIds: row.externalGroupIds ?? [],
    status: row.status,
    createdAt: millisRequired(row.createdAt),
    updatedAt: millisRequired(row.updatedAt),
    deprovisionedAt: millis(row.deprovisionedAt),
  }
}

function auditExportFromRow(row: AuditExportRow): WorkspaceAuditExportRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    requestedByPrincipalId: row.requestedByPrincipalId,
    fromRecordedAt: millis(row.fromRecordedAt),
    toRecordedAt: millisRequired(row.toRecordedAt),
    eventCount: row.eventCount,
    createdAt: millisRequired(row.createdAt),
  }
}

function sharingPolicyFromRow(row: SharingPolicyRow): WorkspaceSharingPolicy {
  return {
    workspaceId: row.workspaceId,
    publicLinksEnabled: row.publicLinksEnabled,
    memberCanCreateChannels: row.memberCanCreateChannels,
    memberCanCreateAgents: row.memberCanCreateAgents,
    memberCanInvite: row.memberCanInvite,
    guestExpirationDays: row.guestExpirationDays ?? undefined,
    allowedAgentHarnesses: row.allowedAgentHarnesses?.length
      ? row.allowedAgentHarnesses as WorkspaceSharingPolicy['allowedAgentHarnesses']
      : undefined,
    agentRunBudgetCents: row.agentRunBudgetCents ?? undefined,
    channelRetentionDays: row.channelRetentionDays ?? undefined,
    legalHold: row.legalHold,
    dataResidency: row.dataResidency ?? undefined,
    rolloutStage: row.rolloutStage,
    updatedByPrincipalId: row.updatedByPrincipalId ?? undefined,
    updatedAt: millisRequired(row.updatedAt),
  }
}

function dateOrNull(value: number | undefined): Date | null {
  return value === undefined ? null : new Date(value)
}

function millis(value: DateValue | null): number | undefined {
  return value === null ? undefined : millisRequired(value)
}

function millisRequired(value: DateValue): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function required<T>(value: T | undefined, action: string): T {
  if (value === undefined) throw new Error(`Postgres failed to ${action}`)
  return value
}

function requiredAccess(value: WorkspaceAccess | null): WorkspaceAccess {
  if (!value) throw new Error('Postgres failed to load workspace access')
  return value
}
