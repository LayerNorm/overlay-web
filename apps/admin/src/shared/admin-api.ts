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

import type {
  AdminAuditRow,
  AdminCatalogResource,
  AdminPrincipal,
  AdminUsageRow,
} from './admin-types'

type Assignment =
  | ({ type: 'group' } & GroupRoleAssignment)
  | ({ type: 'user' } & UserRoleAssignment)

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AdminApiError'
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
  })
  if (response.status === 403) {
    const body = await response.clone().json().catch(() => null) as { error?: string } | null
    if (body?.error === 'recent_sign_in_required') {
      // Intentional full navigation: re-auth flows through the route handlers.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/auth/sign-in?reauth=1&returnTo=${encodeURIComponent(window.location.pathname)}`)
    }
  }
  return response
}

function jsonRequest(body: unknown, init?: RequestInit): RequestInit {
  return {
    ...init,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  }
}

function appendQuery(path: string, query: Record<string, unknown>): string {
  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    url.searchParams.set(key, String(value))
  }
  return `${url.pathname}${url.search}`
}

async function checkedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init)
  const body = (await response.json().catch(() => null)) as ({ error?: string } & T) | null
  if (!response.ok) {
    throw new AdminApiError(response.status, body?.error ?? 'request_failed', body?.error ?? `Request failed (HTTP ${response.status})`)
  }
  return body as T
}

export const adminApi = {
  admin: {
    async listAudit(query: { action?: string; actorUserId?: string; before?: number; limit?: number; resourceType?: string } = {}, init?: RequestInit) {
      const { events } = await checkedJson<{ events: AdminAuditRow[] }>(appendQuery('/api/v1/admin/audit', query), init)
      return events
    },
    async listPrincipals(init?: RequestInit) {
      const { principals } = await checkedJson<{ principals: AdminPrincipal[] }>('/api/v1/admin/principals', init)
      return principals
    },
    async listUsage(query: { limit?: number; userId?: string } = {}, init?: RequestInit) {
      const { usage } = await checkedJson<{ usage: AdminUsageRow[] }>(appendQuery('/api/v1/admin/usage', query), init)
      return usage
    },
  },

  adminAuthorization: {
    addMembershipResponse(body: { groupId: string; userId: string }, init?: RequestInit) {
      return request('/api/v1/admin/authorization/memberships', jsonRequest(body, { ...init, method: 'POST' }))
    },

    archiveGroupResponse(groupId: string, init?: RequestInit) {
      return request('/api/v1/admin/authorization/groups', jsonRequest({ groupId }, { ...init, method: 'DELETE' }))
    },

    archiveRoleResponse(roleId: string, init?: RequestInit) {
      return request('/api/v1/admin/authorization/roles', jsonRequest({ roleId }, { ...init, method: 'DELETE' }))
    },

    assignRoleResponse(body: { roleId: string; subjectId: string; subjectType: 'group' | 'user' }, init?: RequestInit) {
      return request('/api/v1/admin/authorization/assignments', jsonRequest(body, { ...init, method: 'POST' }))
    },

    createGroupResponse(body: { description?: string; name: string }, init?: RequestInit) {
      return request('/api/v1/admin/authorization/groups', jsonRequest(body, { ...init, method: 'POST' }))
    },

    createRoleResponse(body: { capabilities: AuthorizationCapability[]; description?: string; name: string }, init?: RequestInit) {
      return request('/api/v1/admin/authorization/roles', jsonRequest(body, { ...init, method: 'POST' }))
    },

    async listAssignments(query: { subjectId: string; subjectType: 'group' | 'user' }, init?: RequestInit) {
      const { assignments } = await checkedJson<{ assignments: Assignment[] }>(
        appendQuery('/api/v1/admin/authorization/assignments', query), init)
      return assignments
    },

    async listCapabilities(init?: RequestInit) {
      const { capabilities } = await checkedJson<{ capabilities: AuthorizationCapabilityDefinition[] }>(
        '/api/v1/admin/authorization/capabilities', init)
      return capabilities
    },

    async listCatalogResources(init?: RequestInit) {
      const { resources } = await checkedJson<{ resources: AdminCatalogResource[] }>('/api/v1/admin/catalog', init)
      return resources
    },

    async listGroups(query: { includeArchived?: boolean } = {}, init?: RequestInit) {
      const { groups } = await checkedJson<{ groups: AuthorizationGroup[] }>(
        appendQuery('/api/v1/admin/authorization/groups', query), init)
      return groups
    },

    async listMemberships(groupId: string, init?: RequestInit) {
      const { memberships } = await checkedJson<{ memberships: GroupMembership[] }>(
        appendQuery('/api/v1/admin/authorization/memberships', { groupId }), init)
      return memberships
    },

    async listResourceGrants(query: { resourceId: string; resourceType: string }, init?: RequestInit) {
      const { grants } = await checkedJson<{ grants: ResourceGrant[] }>(
        appendQuery('/api/v1/admin/authorization/grants', query), init)
      return grants
    },

    async listRoleAssignments(roleId: string, init?: RequestInit) {
      const { assignments } = await checkedJson<{
        assignments: { groups: GroupRoleAssignment[]; users: UserRoleAssignment[] }
      }>(appendQuery('/api/v1/admin/authorization/assignments', { roleId }), init)
      return assignments
    },

    async listRoles(query: { includeArchived?: boolean } = {}, init?: RequestInit) {
      const { roles } = await checkedJson<{ roles: AuthorizationRole[] }>(
        appendQuery('/api/v1/admin/authorization/roles', query), init)
      return roles
    },

    removeMembershipResponse(body: { groupId: string; userId: string }, init?: RequestInit) {
      return request('/api/v1/admin/authorization/memberships', jsonRequest(body, { ...init, method: 'DELETE' }))
    },

    removeResourceGrantResponse(grantId: string, init?: RequestInit) {
      return request('/api/v1/admin/authorization/grants', jsonRequest({ grantId }, { ...init, method: 'DELETE' }))
    },

    revokeRoleResponse(body: { roleId: string; subjectId: string; subjectType: 'group' | 'user' }, init?: RequestInit) {
      return request('/api/v1/admin/authorization/assignments', jsonRequest(body, { ...init, method: 'DELETE' }))
    },

    updateGroupResponse(body: { description?: string; groupId: string; name?: string }, init?: RequestInit) {
      return request('/api/v1/admin/authorization/groups', jsonRequest(body, { ...init, method: 'PATCH' }))
    },

    updateRoleResponse(body: { capabilities?: AuthorizationCapability[]; description?: string; name?: string; roleId: string }, init?: RequestInit) {
      return request('/api/v1/admin/authorization/roles', jsonRequest(body, { ...init, method: 'PATCH' }))
    },

    upsertResourceGrantResponse(body: {
      accessRole: ResourceAccessRole
      principalId: string
      principalType: AuthorizationPrincipalType
      resourceId: string
      resourceType: string
    }, init?: RequestInit) {
      return request('/api/v1/admin/authorization/grants', jsonRequest(body, { ...init, method: 'POST' }))
    },
  },
}

/** Drop-in alias matching the web app's `overlayAppClient` import in ported UI files. */
export const overlayAppClient = adminApi
