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
  async create(input: CreateRoleInput): Promise<AuthorizationRole> {
    return role(await requiredMutation<ConvexRole>('createRoleByServer', {
      roleId: input.id,
      name: input.name,
      description: input.description,
      capabilities: input.capabilities,
      isSystem: input.isSystem ?? false,
      createdBy: input.createdBy,
    }))
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

  async update(input: UpdateRoleInput): Promise<AuthorizationRole | null> {
    const row = await mutation<ConvexRole | null>('updateRoleByServer', {
      roleId: input.id,
      name: input.name,
      description: input.description,
      capabilities: input.capabilities,
    })
    return row ? role(row) : null
  }

  async archive(args: { id: string; archivedBy?: string }): Promise<boolean> {
    const result = await mutation<{ archived: boolean }>('archiveRoleByServer', { roleId: args.id })
    return result?.archived === true
  }
}

class ConvexAuthorizationGroupRepository implements GroupRepository {
  async create(input: CreateGroupInput): Promise<AuthorizationGroup> {
    return group(await requiredMutation<ConvexGroup>('createGroupByServer', {
      groupId: input.id,
      name: input.name,
      description: input.description,
      source: input.source ?? 'local',
      externalId: input.externalId,
      createdBy: input.createdBy,
    }))
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

  async update(input: UpdateGroupInput): Promise<AuthorizationGroup | null> {
    const row = await mutation<ConvexGroup | null>('updateGroupByServer', {
      groupId: input.id,
      name: input.name,
      description: input.description,
    })
    return row ? group(row) : null
  }

  async archive(args: { id: string; archivedBy?: string }): Promise<boolean> {
    const result = await mutation<{ archived: boolean }>('archiveGroupByServer', { groupId: args.id })
    return result?.archived === true
  }

  async addMember(args: {
    groupId: string
    userId: string
    source?: GroupMembership['source']
  }): Promise<GroupMembership> {
    return clean(await requiredMutation<GroupMembership>('addGroupMemberByServer', {
      ...args,
      source: args.source ?? 'local',
    }))
  }

  async removeMember(args: { groupId: string; userId: string }): Promise<boolean> {
    const result = await mutation<{ removed: boolean }>('removeGroupMemberByServer', args)
    return result?.removed === true
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
  async assignUser(args: {
    userId: string
    roleId: string
    assignedBy?: string
  }): Promise<UserRoleAssignment> {
    return clean(await requiredMutation<UserRoleAssignment>('assignUserRoleByServer', args))
  }

  async revokeUser(args: { userId: string; roleId: string }): Promise<boolean> {
    const result = await mutation<{ removed: boolean }>('revokeUserRoleByServer', args)
    return result?.removed === true
  }

  async listForUser(userId: string): Promise<UserRoleAssignment[]> {
    const rows = await query<UserRoleAssignment[]>('listUserRolesByServer', { userId }) ?? []
    return rows.map(clean)
  }

  async assignGroup(args: {
    groupId: string
    roleId: string
    assignedBy?: string
  }): Promise<GroupRoleAssignment> {
    return clean(await requiredMutation<GroupRoleAssignment>('assignGroupRoleByServer', args))
  }

  async revokeGroup(args: { groupId: string; roleId: string }): Promise<boolean> {
    const result = await mutation<{ removed: boolean }>('revokeGroupRoleByServer', args)
    return result?.removed === true
  }

  async listForGroups(groupIds: string[]): Promise<GroupRoleAssignment[]> {
    const rows = await query<GroupRoleAssignment[]>('listGroupRolesByServer', { groupIds }) ?? []
    return rows.map(clean)
  }
}

class ConvexAuthorizationResourceGrantRepository implements ResourceGrantRepository {
  async upsert(input: UpsertResourceGrantInput): Promise<ResourceGrant> {
    return grant(await requiredMutation<ConvexGrant>('upsertResourceGrantByServer', {
      grantId: input.id,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      principalType: input.principalType,
      principalId: input.principalId,
      accessRole: input.accessRole,
      grantedBy: input.grantedBy,
    }))
  }

  async remove(id: string): Promise<boolean> {
    const result = await mutation<{ removed: boolean }>('removeResourceGrantByServer', { grantId: id })
    return result?.removed === true
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

export function createConvexAuthorizationRepositories(): AuthorizationRepositories {
  return {
    roles: new ConvexAuthorizationRoleRepository(),
    groups: new ConvexAuthorizationGroupRepository(),
    assignments: new ConvexAuthorizationRoleAssignmentRepository(),
    resourceGrants: new ConvexAuthorizationResourceGrantRepository(),
  }
}

function query<T>(operation: string, args: Record<string, unknown>): Promise<T | null> {
  return convex.query<T>(
    `admin/authorization:${operation}`,
    { ...args, serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
}

function mutation<T>(operation: string, args: Record<string, unknown>): Promise<T | null> {
  return convex.mutation<T>(
    `admin/authorization:${operation}`,
    { ...args, serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
}

async function requiredMutation<T>(operation: string, args: Record<string, unknown>): Promise<T> {
  const result = await mutation<T>(operation, args)
  if (!result) throw new Error(`Convex authorization operation ${operation} returned no result`)
  return result
}

function role(row: ConvexRole): AuthorizationRole {
  return { ...clean(row), id: row.roleId ?? row.id }
}

function group(row: ConvexGroup): AuthorizationGroup {
  return { ...clean(row), id: row.groupId ?? row.id }
}

function grant(row: ConvexGrant): ResourceGrant {
  return { ...clean(row), id: row.grantId ?? row.id }
}

function clean<T>(row: T): T {
  const { _id: _, _creationTime: __, roleId: ___, groupId: ____, grantId: _____, ...value } = row as T & {
    _id?: string
    _creationTime?: number
    roleId?: string
    groupId?: string
    grantId?: string
  }
  return value as T
}
