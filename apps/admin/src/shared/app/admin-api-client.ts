'use client'

/**
 * Local stand-in for `@overlay/api-client`'s AdminAuthorizationClient.
 * The real package reaches into the web app's src/** internals, which the
 * admin app must not import — so the console calls its own same-shaped
 * /api/v1/admin/* routes directly.
 */
import type {
  AuthorizationCapability,
  AuthorizationCapabilityDefinition,
  AuthorizationGroup,
  AuthorizationPrincipalType,
  AuthorizationRole,
  GroupMembership,
  GroupRoleAssignment,
  ResourceAccessRole,
  ResourceGrant,
  UserRoleAssignment,
} from '@overlay/authz-contracts'

export type AdminCatalogResourceType = 'connector' | 'model' | 'tool'

export type AdminCatalogResource = {
  category?: string
  description?: string
  id: string
  label: string
  resourceType: AdminCatalogResourceType
}

type Assignment = UserRoleAssignment | GroupRoleAssignment

function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { credentials: 'same-origin', ...init })
}

function jsonRequest(body: unknown, init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: JSON.stringify(body),
  }
}

function appendQuery(path: string, query: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

async function checkedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init)
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) {
    throw Object.assign(
      new Error(payload.error || 'Authorization administration request failed'),
      { status: response.status },
    )
  }
  return payload
}

export const adminAuthorization = {
  async listCatalogResources(init?: RequestInit) {
    const { resources } = await checkedJson<{ resources: AdminCatalogResource[] }>(
      '/api/v1/admin/catalog',
      init,
    )
    return resources
  },

  async listCapabilities(init?: RequestInit) {
    const { capabilities } = await checkedJson<{
      capabilities: AuthorizationCapabilityDefinition[]
    }>('/api/v1/admin/authorization/capabilities', init)
    return capabilities
  },

  async listRoles(query: { includeArchived?: boolean } = {}, init?: RequestInit) {
    const { roles } = await checkedJson<{ roles: AuthorizationRole[] }>(
      appendQuery('/api/v1/admin/authorization/roles', query),
      init,
    )
    return roles
  },

  createRoleResponse(
    body: { name: string; description?: string; capabilities: AuthorizationCapability[] },
    init?: RequestInit,
  ) {
    return request(
      '/api/v1/admin/authorization/roles',
      jsonRequest(body, { ...init, method: 'POST' }),
    )
  },

  updateRoleResponse(
    body: {
      roleId: string
      name?: string
      description?: string
      capabilities?: AuthorizationCapability[]
    },
    init?: RequestInit,
  ) {
    return request(
      '/api/v1/admin/authorization/roles',
      jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  },

  archiveRoleResponse(roleId: string, init?: RequestInit) {
    return request(
      '/api/v1/admin/authorization/roles',
      jsonRequest({ roleId }, { ...init, method: 'DELETE' }),
    )
  },

  async listGroups(query: { includeArchived?: boolean } = {}, init?: RequestInit) {
    const { groups } = await checkedJson<{ groups: AuthorizationGroup[] }>(
      appendQuery('/api/v1/admin/authorization/groups', query),
      init,
    )
    return groups
  },

  createGroupResponse(body: { name: string; description?: string }, init?: RequestInit) {
    return request(
      '/api/v1/admin/authorization/groups',
      jsonRequest(body, { ...init, method: 'POST' }),
    )
  },

  updateGroupResponse(
    body: { groupId: string; name?: string; description?: string },
    init?: RequestInit,
  ) {
    return request(
      '/api/v1/admin/authorization/groups',
      jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  },

  archiveGroupResponse(groupId: string, init?: RequestInit) {
    return request(
      '/api/v1/admin/authorization/groups',
      jsonRequest({ groupId }, { ...init, method: 'DELETE' }),
    )
  },

  async listMemberships(groupId: string, init?: RequestInit) {
    const { memberships } = await checkedJson<{ memberships: GroupMembership[] }>(
      appendQuery('/api/v1/admin/authorization/memberships', { groupId }),
      init,
    )
    return memberships
  },

  addMembershipResponse(body: { groupId: string; userId: string }, init?: RequestInit) {
    return request(
      '/api/v1/admin/authorization/memberships',
      jsonRequest(body, { ...init, method: 'POST' }),
    )
  },

  removeMembershipResponse(body: { groupId: string; userId: string }, init?: RequestInit) {
    return request(
      '/api/v1/admin/authorization/memberships',
      jsonRequest(body, { ...init, method: 'DELETE' }),
    )
  },

  async listAssignments(
    query: { subjectType: 'user' | 'group'; subjectId: string },
    init?: RequestInit,
  ) {
    const { assignments } = await checkedJson<{ assignments: Assignment[] }>(
      appendQuery('/api/v1/admin/authorization/assignments', query),
      init,
    )
    return assignments
  },

  async listRoleAssignments(roleId: string, init?: RequestInit) {
    const { assignments } = await checkedJson<{
      assignments: { users: UserRoleAssignment[]; groups: GroupRoleAssignment[] }
    }>(appendQuery('/api/v1/admin/authorization/assignments', { roleId }), init)
    return assignments
  },

  assignRoleResponse(
    body: { subjectType: 'user' | 'group'; subjectId: string; roleId: string },
    init?: RequestInit,
  ) {
    return request(
      '/api/v1/admin/authorization/assignments',
      jsonRequest(body, { ...init, method: 'POST' }),
    )
  },

  revokeRoleResponse(
    body: { subjectType: 'user' | 'group'; subjectId: string; roleId: string },
    init?: RequestInit,
  ) {
    return request(
      '/api/v1/admin/authorization/assignments',
      jsonRequest(body, { ...init, method: 'DELETE' }),
    )
  },

  async listResourceGrants(
    query: { resourceType: string; resourceId: string },
    init?: RequestInit,
  ) {
    const { grants } = await checkedJson<{ grants: ResourceGrant[] }>(
      appendQuery('/api/v1/admin/authorization/grants', query),
      init,
    )
    return grants
  },

  upsertResourceGrantResponse(
    body: {
      resourceType: string
      resourceId: string
      principalType: AuthorizationPrincipalType
      principalId: string
      accessRole: ResourceAccessRole
    },
    init?: RequestInit,
  ) {
    return request(
      '/api/v1/admin/authorization/grants',
      jsonRequest(body, { ...init, method: 'POST' }),
    )
  },

  removeResourceGrantResponse(grantId: string, init?: RequestInit) {
    return request(
      '/api/v1/admin/authorization/grants',
      jsonRequest({ grantId }, { ...init, method: 'DELETE' }),
    )
  },
}

/** Same access pattern the copied panels use (`overlayAppClient.adminAuthorization.*`). */
export const adminApiClient = { adminAuthorization }
