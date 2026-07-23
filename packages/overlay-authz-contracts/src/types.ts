import type { AuthorizationCapability } from './capabilities'

export const AUTHORIZATION_PRINCIPAL_TYPES = ['user', 'group', 'role'] as const
export type AuthorizationPrincipalType = (typeof AUTHORIZATION_PRINCIPAL_TYPES)[number]

export const RESOURCE_ACCESS_ROLES = ['viewer', 'editor', 'owner'] as const
export type ResourceAccessRole = (typeof RESOURCE_ACCESS_ROLES)[number]

export const RESOURCE_ACTIONS = ['view', 'edit', 'delete', 'share'] as const
export type ResourceAction = (typeof RESOURCE_ACTIONS)[number]

export type AuthorizationRole = {
  id: string
  name: string
  description?: string
  capabilities: AuthorizationCapability[]
  isSystem: boolean
  createdBy?: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export type AuthorizationGroup = {
  id: string
  name: string
  description?: string
  source: 'local' | 'external'
  externalId?: string
  createdBy?: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export type GroupMembership = {
  groupId: string
  userId: string
  source: 'local' | 'external'
  createdAt: number
}

export type UserRoleAssignment = {
  userId: string
  roleId: string
  assignedBy?: string
  createdAt: number
}

export type GroupRoleAssignment = {
  groupId: string
  roleId: string
  assignedBy?: string
  createdAt: number
}

export type ResourceGrant = {
  id: string
  resourceType: string
  resourceId: string
  principalType: AuthorizationPrincipalType
  principalId: string
  accessRole: ResourceAccessRole
  grantedBy?: string
  createdAt: number
  updatedAt: number
}

export type AuthorizationSubject = {
  userId: string
  groupIds: string[]
  roleIds: string[]
  capabilities: AuthorizationCapability[]
  isDeploymentOwner: boolean
}

export type AuthorizationDecision = {
  allowed: boolean
  capability: AuthorizationCapability
  resourceType?: string
  resourceId?: string
  requiredAction?: ResourceAction
  effectiveAccessRole?: ResourceAccessRole
  reason:
    | 'deployment_owner'
    | 'capability_disabled'
    | 'capability_missing'
    | 'resource_owner'
    | 'resource_access_granted'
    | 'resource_access_missing'
}

const ACCESS_ROLE_RANK: Record<ResourceAccessRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
}

const ACTION_MINIMUM_ROLE: Record<ResourceAction, ResourceAccessRole> = {
  view: 'viewer',
  edit: 'editor',
  delete: 'owner',
  share: 'owner',
}

export function isAuthorizationPrincipalType(value: unknown): value is AuthorizationPrincipalType {
  return typeof value === 'string' && AUTHORIZATION_PRINCIPAL_TYPES.includes(
    value as AuthorizationPrincipalType,
  )
}

export function isResourceAccessRole(value: unknown): value is ResourceAccessRole {
  return typeof value === 'string' && RESOURCE_ACCESS_ROLES.includes(value as ResourceAccessRole)
}

export function accessRoleAllows(role: ResourceAccessRole, action: ResourceAction): boolean {
  return ACCESS_ROLE_RANK[role] >= ACCESS_ROLE_RANK[ACTION_MINIMUM_ROLE[action]]
}

export function strongestAccessRole(
  roles: readonly ResourceAccessRole[],
): ResourceAccessRole | undefined {
  return roles.reduce<ResourceAccessRole | undefined>((strongest, role) => (
    !strongest || ACCESS_ROLE_RANK[role] > ACCESS_ROLE_RANK[strongest] ? role : strongest
  ), undefined)
}
