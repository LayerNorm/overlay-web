import type { AuthorizationCapability } from './capabilities'
import type {
  AuthorizationGroup,
  AuthorizationRole,
  GroupMembership,
  GroupRoleAssignment,
  ResourceGrant,
  UserRoleAssignment,
} from './types'

export type CreateRoleInput = {
  id: string
  name: string
  description?: string
  capabilities: AuthorizationCapability[]
  createdBy?: string
  isSystem?: boolean
}

export type UpdateRoleInput = {
  id: string
  name?: string
  description?: string
  capabilities?: AuthorizationCapability[]
}

export interface RoleRepository {
  create(input: CreateRoleInput): Promise<AuthorizationRole>
  get(id: string): Promise<AuthorizationRole | null>
  list(args?: { includeArchived?: boolean }): Promise<AuthorizationRole[]>
  update(input: UpdateRoleInput): Promise<AuthorizationRole | null>
  archive(args: { id: string; archivedBy?: string }): Promise<boolean>
}

export type CreateGroupInput = {
  id: string
  name: string
  description?: string
  source?: AuthorizationGroup['source']
  externalId?: string
  createdBy?: string
}

export type UpdateGroupInput = {
  id: string
  name?: string
  description?: string
}

export interface GroupRepository {
  create(input: CreateGroupInput): Promise<AuthorizationGroup>
  get(id: string): Promise<AuthorizationGroup | null>
  list(args?: { includeArchived?: boolean }): Promise<AuthorizationGroup[]>
  update(input: UpdateGroupInput): Promise<AuthorizationGroup | null>
  archive(args: { id: string; archivedBy?: string }): Promise<boolean>
  addMember(args: {
    groupId: string
    userId: string
    source?: GroupMembership['source']
  }): Promise<GroupMembership>
  removeMember(args: { groupId: string; userId: string }): Promise<boolean>
  listMembers(groupId: string): Promise<GroupMembership[]>
  listForUser(userId: string): Promise<AuthorizationGroup[]>
}

export interface RoleAssignmentRepository {
  assignUser(args: { userId: string; roleId: string; assignedBy?: string }): Promise<UserRoleAssignment>
  revokeUser(args: { userId: string; roleId: string }): Promise<boolean>
  listForUser(userId: string): Promise<UserRoleAssignment[]>
  assignGroup(args: { groupId: string; roleId: string; assignedBy?: string }): Promise<GroupRoleAssignment>
  revokeGroup(args: { groupId: string; roleId: string }): Promise<boolean>
  listForGroups(groupIds: string[]): Promise<GroupRoleAssignment[]>
}

export type UpsertResourceGrantInput = Omit<ResourceGrant, 'createdAt' | 'updatedAt'>

export interface ResourceGrantRepository {
  upsert(input: UpsertResourceGrantInput): Promise<ResourceGrant>
  remove(id: string): Promise<boolean>
  listForResource(args: { resourceType: string; resourceId: string }): Promise<ResourceGrant[]>
  listForPrincipals(args: {
    userId: string
    groupIds: string[]
    roleIds: string[]
    resourceType?: string
  }): Promise<ResourceGrant[]>
}

export interface AuthorizationRepositories {
  roles: RoleRepository
  groups: GroupRepository
  assignments: RoleAssignmentRepository
  resourceGrants: ResourceGrantRepository
}
