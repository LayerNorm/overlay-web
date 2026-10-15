import 'server-only'

import type {
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
  ResourceOwnerRepository,
  RoleAssignmentRepository,
  RoleRepository,
  UpdateGroupInput,
  UpdateRoleInput,
  UpsertResourceGrantInput,
  UserRoleAssignment,
} from '@overlay/authz-contracts'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

type ConvexRole = AuthorizationRole & { roleId?: string }
type ConvexGroup = AuthorizationGroup & { groupId?: string }
type ConvexGrant = ResourceGrant & { grantId?: string }

class ConvexAuthorizationRoleRepository implements RoleRepository {
  async create(_input: CreateRoleInput): Promise<AuthorizationRole> {
    throw new Error('Operator writes require the standalone admin console')
  }

  async get(id: string): Promise<AuthorizationRole | null> {
    const row = await query<ConvexRole | null>('getRoleByServer', { roleId: id })
    return row ? role(row) : null
  }

  async list(args: { includeArchived?: boolean } = {}): Promise<AuthorizationRole[]> {
    const rows = await query<ConvexRole[]>('listRolesByServer', {
      includeArchived: args.includeArchived ?? false,
    }) ?? []
    return rows.map(role)
  }

  async update(_input: UpdateRoleInput): Promise<AuthorizationRole | null> {
    throw new Error('Operator writes require the standalone admin console')
  }

  async archive(_args: { id: string; archivedBy?: string }): Promise<boolean> {
    throw new Error('Operator writes require the standalone admin console')
  }
}

class ConvexAuthorizationGroupRepository implements GroupRepository {
  async create(_input: CreateGroupInput): Promise<AuthorizationGroup> {
    throw new Error('Operator writes require the standalone admin console')
  }

  async get(id: string): Promise<AuthorizationGroup | null> {
    const row = await query<ConvexGroup | null>('getGroupByServer', { groupId: id })
    return row ? group(row) : null
  }

  async list(args: { includeArchived?: boolean } = {}): Promise<AuthorizationGroup[]> {
    const rows = await query<ConvexGroup[]>('listGroupsByServer', {
      includeArchived: args.includeArchived ?? false,
    }) ?? []
    return rows.map(group)
  }

  async update(_input: UpdateGroupInput): Promise<AuthorizationGroup | null> {
    throw new Error('Operator writes require the standalone admin console')
  }

  async archive(_args: { id: string; archivedBy?: string }): Promise<boolean> {
    throw new Error('Operator writes require the standalone admin console')
  }

  async addMember(_args: {
    groupId: string
    userId: string
    source?: GroupMembership['source']
  }): Promise<GroupMembership> {
    throw new Error('Operator writes require the standalone admin console')
  }

  async removeMember(_args: { groupId: string; userId: string }): Promise<boolean> {
    throw new Error('Operator writes require the standalone admin console')
  }

  async listMembers(groupId: string): Promise<GroupMembership[]> {
    const rows = await query<GroupMembership[]>('listGroupMembersByServer', { groupId }) ?? []
    return rows.map(clean)
  }

  async listForUser(userId: string): Promise<AuthorizationGroup[]> {
    const rows = await query<ConvexGroup[]>('listGroupsForUserByServer', { userId }) ?? []
    return rows.map(group)
  }
}

class ConvexAuthorizationRoleAssignmentRepository implements RoleAssignmentRepository {
  async assignUser(_args: {
    userId: string
    roleId: string
    assignedBy?: string
  }): Promise<UserRoleAssignment> {
    throw new Error('Operator writes require the standalone admin console')
  }

  async revokeUser(_args: { userId: string; roleId: string }): Promise<boolean> {
    throw new Error('Operator writes require the standalone admin console')
  }

  async listForUser(userId: string): Promise<UserRoleAssignment[]> {
    const rows = await query<UserRoleAssignment[]>('listUserRolesByServer', { userId }) ?? []
    return rows.map(clean)
  }

  async listUsersForRole(roleId: string): Promise<UserRoleAssignment[]> {
    const rows = await query<UserRoleAssignment[]>('listUsersForRoleByServer', { roleId }) ?? []
    return rows.map(clean)
  }

  async assignGroup(_args: {
    groupId: string
    roleId: string
    assignedBy?: string
  }): Promise<GroupRoleAssignment> {
    throw new Error('Operator writes require the standalone admin console')
  }

  async revokeGroup(_args: { groupId: string; roleId: string }): Promise<boolean> {
    throw new Error('Operator writes require the standalone admin console')
  }

  async listForGroups(groupIds: string[]): Promise<GroupRoleAssignment[]> {
    const rows = await query<GroupRoleAssignment[]>('listGroupRolesByServer', { groupIds }) ?? []
    return rows.map(clean)
  }

  async listGroupsForRole(roleId: string): Promise<GroupRoleAssignment[]> {
    const rows = await query<GroupRoleAssignment[]>('listGroupsForRoleByServer', { roleId }) ?? []
    return rows.map(clean)
  }
}

class ConvexAuthorizationResourceGrantRepository implements ResourceGrantRepository {
  async upsert(_input: UpsertResourceGrantInput): Promise<ResourceGrant> {
    throw new Error('Operator writes require the standalone admin console')
  }

  async remove(_id: string): Promise<boolean> {
    throw new Error('Operator writes require the standalone admin console')
  }

  async listForResource(args: {
    resourceType: string
    resourceId: string
  }): Promise<ResourceGrant[]> {
    const rows = await query<ConvexGrant[]>('listResourceGrantsByServer', args) ?? []
    return rows.map(grant)
  }

  async listForPrincipals(args: {
    userId: string
    groupIds: string[]
    roleIds: string[]
    resourceType?: string
  }): Promise<ResourceGrant[]> {
    const rows = await query<ConvexGrant[]>('listPrincipalGrantsByServer', args) ?? []
    return rows.map(grant)
  }
}

class ConvexAuthorizationResourceOwnerRepository implements ResourceOwnerRepository {
  async getOwner(args: { resourceType: string; resourceId: string }): Promise<string | null> {
    const result = await query<{ userId: string } | null>('getResourceOwnerByServer', args)
    return result?.userId ?? null
  }
}

export function createConvexAuthorizationRepositories(): AuthorizationRepositories {
  return {
    roles: new ConvexAuthorizationRoleRepository(),
    groups: new ConvexAuthorizationGroupRepository(),
    assignments: new ConvexAuthorizationRoleAssignmentRepository(),
    resourceGrants: new ConvexAuthorizationResourceGrantRepository(),
    resourceOwners: new ConvexAuthorizationResourceOwnerRepository(),
  }
}

function query<T>(operation: string, args: Record<string, unknown>): Promise<T | null> {
  return convex.query<T>(
    `admin/authorization:${operation}`,
    { ...args, serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
}

function role(row: ConvexRole): AuthorizationRole {
  const { roleId, ...value } = clean(row)
  return { ...value, id: roleId ?? row.id }
}

function group(row: ConvexGroup): AuthorizationGroup {
  const { groupId, ...value } = clean(row)
  return { ...value, id: groupId ?? row.id }
}

function grant(row: ConvexGrant): ResourceGrant {
  const { grantId, ...value } = clean(row)
  return { ...value, id: grantId ?? row.id }
}

function clean<T>(row: T): T {
  const { _id: _, _creationTime: __, ...value } = row as T & {
    _id?: string
    _creationTime?: number
  }
  return value as T
}
