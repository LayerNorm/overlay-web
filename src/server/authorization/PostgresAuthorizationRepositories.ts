import 'server-only'

import { sql, type SQL } from 'drizzle-orm'
import type {
  AuthorizationCapability,
  AuthorizationGroup,
  AuthorizationRepositories,
  AuthorizationRole,
  CreateGroupInput,
  CreateRoleInput,
  GroupMembership,
  GroupRepository,
  GroupRoleAssignment,
  ResourceGrant,
  ResourceGrantRepository,
  RoleAssignmentRepository,
  RoleRepository,
  UpdateGroupInput,
  UpdateRoleInput,
  UpsertResourceGrantInput,
  UserRoleAssignment,
} from '@overlay/authz-contracts'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'

type RoleRow = Omit<AuthorizationRole, 'createdAt' | 'updatedAt' | 'archivedAt'> & {
  createdAt: Date | string
  updatedAt: Date | string
  archivedAt: Date | string | null
}

type GroupRow = Omit<AuthorizationGroup, 'createdAt' | 'updatedAt' | 'archivedAt'> & {
  createdAt: Date | string
  updatedAt: Date | string
  archivedAt: Date | string | null
}

type MembershipRow = Omit<GroupMembership, 'createdAt'> & { createdAt: Date | string }
type UserRoleRow = Omit<UserRoleAssignment, 'createdAt'> & { createdAt: Date | string }
type GroupRoleRow = Omit<GroupRoleAssignment, 'createdAt'> & { createdAt: Date | string }
type GrantRow = Omit<ResourceGrant, 'createdAt' | 'updatedAt'> & {
  createdAt: Date | string
  updatedAt: Date | string
}

export class PostgresAuthorizationRoleRepository implements RoleRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async create(input: CreateRoleInput): Promise<AuthorizationRole> {
    const result = await this.db.execute<RoleRow>(sql`
      INSERT INTO authorization_roles (
        id, name, description, capabilities, is_system, created_by
      ) VALUES (
        ${input.id}, ${input.name}, ${input.description ?? null},
        ${textArray(input.capabilities)}, ${input.isSystem ?? false}, ${input.createdBy ?? null}
      )
      RETURNING ${roleColumns}
    `)
    return roleFromRow(requiredRow(result.rows[0], 'create authorization role'))
  }

  async get(id: string): Promise<AuthorizationRole | null> {
    const result = await this.db.execute<RoleRow>(sql`
      SELECT ${roleColumns} FROM authorization_roles WHERE id = ${id} LIMIT 1
    `)
    return result.rows[0] ? roleFromRow(result.rows[0]) : null
  }

  async list(args: { includeArchived?: boolean } = {}): Promise<AuthorizationRole[]> {
    const result = await this.db.execute<RoleRow>(sql`
      SELECT ${roleColumns}
      FROM authorization_roles
      WHERE ${args.includeArchived ? sql`true` : sql`archived_at IS NULL`}
      ORDER BY lower(name), created_at
    `)
    return result.rows.map(roleFromRow)
  }

  async update(input: UpdateRoleInput): Promise<AuthorizationRole | null> {
    const current = await this.get(input.id)
    if (!current) return null
    const result = await this.db.execute<RoleRow>(sql`
      UPDATE authorization_roles SET
        name = ${input.name ?? current.name},
        description = ${input.description ?? current.description ?? null},
        capabilities = ${textArray(input.capabilities ?? current.capabilities)},
        updated_at = now()
      WHERE id = ${input.id}
      RETURNING ${roleColumns}
    `)
    return roleFromRow(requiredRow(result.rows[0], 'update authorization role'))
  }

  async archive(args: { id: string; archivedBy?: string }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE authorization_roles
      SET archived_at = COALESCE(archived_at, now()), updated_at = now()
      WHERE id = ${args.id}
    `)
    return result.rowCount === 1
  }
}

export class PostgresAuthorizationGroupRepository implements GroupRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async create(input: CreateGroupInput): Promise<AuthorizationGroup> {
    const result = await this.db.execute<GroupRow>(sql`
      INSERT INTO authorization_groups (
        id, name, description, source, external_id, created_by
      ) VALUES (
        ${input.id}, ${input.name}, ${input.description ?? null}, ${input.source ?? 'local'},
        ${input.externalId ?? null}, ${input.createdBy ?? null}
      )
      RETURNING ${groupColumns}
    `)
    return groupFromRow(requiredRow(result.rows[0], 'create authorization group'))
  }

  async get(id: string): Promise<AuthorizationGroup | null> {
    const result = await this.db.execute<GroupRow>(sql`
      SELECT ${groupColumns} FROM authorization_groups WHERE id = ${id} LIMIT 1
    `)
    return result.rows[0] ? groupFromRow(result.rows[0]) : null
  }

  async list(args: { includeArchived?: boolean } = {}): Promise<AuthorizationGroup[]> {
    const result = await this.db.execute<GroupRow>(sql`
      SELECT ${groupColumns}
      FROM authorization_groups
      WHERE ${args.includeArchived ? sql`true` : sql`archived_at IS NULL`}
      ORDER BY lower(name), created_at
    `)
    return result.rows.map(groupFromRow)
  }

  async update(input: UpdateGroupInput): Promise<AuthorizationGroup | null> {
    const current = await this.get(input.id)
    if (!current) return null
    const result = await this.db.execute<GroupRow>(sql`
      UPDATE authorization_groups SET
        name = ${input.name ?? current.name},
        description = ${input.description ?? current.description ?? null},
        updated_at = now()
      WHERE id = ${input.id}
      RETURNING ${groupColumns}
    `)
    return groupFromRow(requiredRow(result.rows[0], 'update authorization group'))
  }

  async archive(args: { id: string; archivedBy?: string }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE authorization_groups
      SET archived_at = COALESCE(archived_at, now()), updated_at = now()
      WHERE id = ${args.id}
    `)
    return result.rowCount === 1
  }

  async addMember(args: {
    groupId: string
    userId: string
    source?: GroupMembership['source']
  }): Promise<GroupMembership> {
    const result = await this.db.execute<MembershipRow>(sql`
      INSERT INTO authorization_group_memberships (group_id, user_id, source)
      VALUES (${args.groupId}, ${args.userId}, ${args.source ?? 'local'})
      ON CONFLICT (group_id, user_id) DO UPDATE SET source = EXCLUDED.source
      RETURNING group_id AS "groupId", user_id AS "userId", source,
                created_at AS "createdAt"
    `)
    return membershipFromRow(requiredRow(result.rows[0], 'add authorization group member'))
  }

  async removeMember(args: { groupId: string; userId: string }): Promise<boolean> {
    const result = await this.db.execute(sql`
      DELETE FROM authorization_group_memberships
      WHERE group_id = ${args.groupId} AND user_id = ${args.userId}
    `)
    return result.rowCount === 1
  }

  async listMembers(groupId: string): Promise<GroupMembership[]> {
    const result = await this.db.execute<MembershipRow>(sql`
      SELECT group_id AS "groupId", user_id AS "userId", source,
             created_at AS "createdAt"
      FROM authorization_group_memberships
      WHERE group_id = ${groupId}
      ORDER BY created_at, user_id
    `)
    return result.rows.map(membershipFromRow)
  }

  async listForUser(userId: string): Promise<AuthorizationGroup[]> {
    const result = await this.db.execute<GroupRow>(sql`
      SELECT ${prefixedGroupColumns}
      FROM authorization_groups groups
      JOIN authorization_group_memberships memberships ON memberships.group_id = groups.id
      WHERE memberships.user_id = ${userId} AND groups.archived_at IS NULL
      ORDER BY lower(groups.name), groups.created_at
    `)
    return result.rows.map(groupFromRow)
  }
}

export class PostgresAuthorizationRoleAssignmentRepository implements RoleAssignmentRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async assignUser(args: {
    userId: string
    roleId: string
    assignedBy?: string
  }): Promise<UserRoleAssignment> {
    const result = await this.db.execute<UserRoleRow>(sql`
      INSERT INTO authorization_user_roles (user_id, role_id, assigned_by)
      VALUES (${args.userId}, ${args.roleId}, ${args.assignedBy ?? null})
      ON CONFLICT (user_id, role_id) DO UPDATE SET assigned_by = EXCLUDED.assigned_by
      RETURNING user_id AS "userId", role_id AS "roleId", assigned_by AS "assignedBy",
                created_at AS "createdAt"
    `)
    return userRoleFromRow(requiredRow(result.rows[0], 'assign authorization role to user'))
  }

  async revokeUser(args: { userId: string; roleId: string }): Promise<boolean> {
    const result = await this.db.execute(sql`
      DELETE FROM authorization_user_roles
      WHERE user_id = ${args.userId} AND role_id = ${args.roleId}
    `)
    return result.rowCount === 1
  }

  async listForUser(userId: string): Promise<UserRoleAssignment[]> {
    const result = await this.db.execute<UserRoleRow>(sql`
      SELECT assignments.user_id AS "userId", assignments.role_id AS "roleId",
             assignments.assigned_by AS "assignedBy", assignments.created_at AS "createdAt"
      FROM authorization_user_roles assignments
      JOIN authorization_roles roles ON roles.id = assignments.role_id
      WHERE assignments.user_id = ${userId} AND roles.archived_at IS NULL
      ORDER BY assignments.created_at, assignments.role_id
    `)
    return result.rows.map(userRoleFromRow)
  }

  async assignGroup(args: {
    groupId: string
    roleId: string
    assignedBy?: string
  }): Promise<GroupRoleAssignment> {
    const result = await this.db.execute<GroupRoleRow>(sql`
      INSERT INTO authorization_group_roles (group_id, role_id, assigned_by)
      VALUES (${args.groupId}, ${args.roleId}, ${args.assignedBy ?? null})
      ON CONFLICT (group_id, role_id) DO UPDATE SET assigned_by = EXCLUDED.assigned_by
      RETURNING group_id AS "groupId", role_id AS "roleId", assigned_by AS "assignedBy",
                created_at AS "createdAt"
    `)
    return groupRoleFromRow(requiredRow(result.rows[0], 'assign authorization role to group'))
  }

  async revokeGroup(args: { groupId: string; roleId: string }): Promise<boolean> {
    const result = await this.db.execute(sql`
      DELETE FROM authorization_group_roles
      WHERE group_id = ${args.groupId} AND role_id = ${args.roleId}
    `)
    return result.rowCount === 1
  }

  async listForGroups(groupIds: string[]): Promise<GroupRoleAssignment[]> {
    if (groupIds.length === 0) return []
    const result = await this.db.execute<GroupRoleRow>(sql`
      SELECT assignments.group_id AS "groupId", assignments.role_id AS "roleId",
             assignments.assigned_by AS "assignedBy", assignments.created_at AS "createdAt"
      FROM authorization_group_roles assignments
      JOIN authorization_roles roles ON roles.id = assignments.role_id
      WHERE assignments.group_id IN (${sql.join(groupIds.map((id) => sql`${id}`), sql`, `)})
        AND roles.archived_at IS NULL
      ORDER BY assignments.created_at, assignments.group_id, assignments.role_id
    `)
    return result.rows.map(groupRoleFromRow)
  }
}

export class PostgresAuthorizationResourceGrantRepository implements ResourceGrantRepository {
  constructor(private readonly db: OverlayPostgresDb) {}

  async upsert(input: UpsertResourceGrantInput): Promise<ResourceGrant> {
    const result = await this.db.execute<GrantRow>(sql`
      INSERT INTO authorization_resource_grants (
        id, resource_type, resource_id, principal_type, principal_id, access_role, granted_by
      ) VALUES (
        ${input.id}, ${input.resourceType}, ${input.resourceId}, ${input.principalType},
        ${input.principalId}, ${input.accessRole}, ${input.grantedBy ?? null}
      )
      ON CONFLICT (resource_type, resource_id, principal_type, principal_id) DO UPDATE SET
        access_role = EXCLUDED.access_role,
        granted_by = EXCLUDED.granted_by,
        updated_at = now()
      RETURNING ${grantColumns}
    `)
    return grantFromRow(requiredRow(result.rows[0], 'upsert authorization resource grant'))
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      DELETE FROM authorization_resource_grants WHERE id = ${id}
    `)
    return result.rowCount === 1
  }

  async listForResource(args: {
    resourceType: string
    resourceId: string
  }): Promise<ResourceGrant[]> {
    const result = await this.db.execute<GrantRow>(sql`
      SELECT ${grantColumns}
      FROM authorization_resource_grants
      WHERE resource_type = ${args.resourceType} AND resource_id = ${args.resourceId}
      ORDER BY created_at, id
    `)
    return result.rows.map(grantFromRow)
  }

  async listForPrincipals(args: {
    userId: string
    groupIds: string[]
    roleIds: string[]
    resourceType?: string
  }): Promise<ResourceGrant[]> {
    const principalPredicates: SQL[] = [
      sql`(principal_type = 'user' AND principal_id = ${args.userId})`,
    ]
    if (args.groupIds.length > 0) {
      principalPredicates.push(sql`(
        principal_type = 'group'
        AND principal_id IN (${sql.join(args.groupIds.map((id) => sql`${id}`), sql`, `)})
      )`)
    }
    if (args.roleIds.length > 0) {
      principalPredicates.push(sql`(
        principal_type = 'role'
        AND principal_id IN (${sql.join(args.roleIds.map((id) => sql`${id}`), sql`, `)})
      )`)
    }
    const result = await this.db.execute<GrantRow>(sql`
      SELECT ${grantColumns}
      FROM authorization_resource_grants
      WHERE (${sql.join(principalPredicates, sql` OR `)})
        ${args.resourceType ? sql`AND resource_type = ${args.resourceType}` : sql``}
      ORDER BY created_at, id
    `)
    return result.rows.map(grantFromRow)
  }
}

export function createPostgresAuthorizationRepositories(
  db: OverlayPostgresDb,
): AuthorizationRepositories {
  return {
    roles: new PostgresAuthorizationRoleRepository(db),
    groups: new PostgresAuthorizationGroupRepository(db),
    assignments: new PostgresAuthorizationRoleAssignmentRepository(db),
    resourceGrants: new PostgresAuthorizationResourceGrantRepository(db),
  }
}

const roleColumns = sql`
  id, name, description, capabilities, is_system AS "isSystem", created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt", archived_at AS "archivedAt"
`

const groupColumns = sql`
  id, name, description, source, external_id AS "externalId", created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt", archived_at AS "archivedAt"
`

const prefixedGroupColumns = sql`
  groups.id, groups.name, groups.description, groups.source,
  groups.external_id AS "externalId", groups.created_by AS "createdBy",
  groups.created_at AS "createdAt", groups.updated_at AS "updatedAt",
  groups.archived_at AS "archivedAt"
`

const grantColumns = sql`
  id, resource_type AS "resourceType", resource_id AS "resourceId",
  principal_type AS "principalType", principal_id AS "principalId",
  access_role AS "accessRole", granted_by AS "grantedBy",
  created_at AS "createdAt", updated_at AS "updatedAt"
`

function roleFromRow(row: RoleRow): AuthorizationRole {
  return {
    ...row,
    description: row.description ?? undefined,
    createdBy: row.createdBy ?? undefined,
    capabilities: row.capabilities as AuthorizationCapability[],
    createdAt: millis(row.createdAt),
    updatedAt: millis(row.updatedAt),
    archivedAt: row.archivedAt ? millis(row.archivedAt) : undefined,
  }
}

function groupFromRow(row: GroupRow): AuthorizationGroup {
  return {
    ...row,
    description: row.description ?? undefined,
    externalId: row.externalId ?? undefined,
    createdBy: row.createdBy ?? undefined,
    source: row.source as AuthorizationGroup['source'],
    createdAt: millis(row.createdAt),
    updatedAt: millis(row.updatedAt),
    archivedAt: row.archivedAt ? millis(row.archivedAt) : undefined,
  }
}

function membershipFromRow(row: MembershipRow): GroupMembership {
  return { ...row, source: row.source as GroupMembership['source'], createdAt: millis(row.createdAt) }
}

function userRoleFromRow(row: UserRoleRow): UserRoleAssignment {
  return { ...row, assignedBy: row.assignedBy ?? undefined, createdAt: millis(row.createdAt) }
}

function groupRoleFromRow(row: GroupRoleRow): GroupRoleAssignment {
  return { ...row, assignedBy: row.assignedBy ?? undefined, createdAt: millis(row.createdAt) }
}

function grantFromRow(row: GrantRow): ResourceGrant {
  return {
    ...row,
    grantedBy: row.grantedBy ?? undefined,
    createdAt: millis(row.createdAt),
    updatedAt: millis(row.updatedAt),
  }
}

function millis(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function requiredRow<T>(row: T | undefined, operation: string): T {
  if (!row) throw new Error(`Failed to ${operation}`)
  return row
}

function textArray(values: readonly string[]): SQL {
  return sql`ARRAY(
    SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb)
  )`
}
