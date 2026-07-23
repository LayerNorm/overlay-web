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
import type { HttpContext } from '../shared/http'

type Assignment = UserRoleAssignment | GroupRoleAssignment

export class AdminAuthorizationClient {
  constructor(private readonly http: HttpContext) {}

  async listCapabilities(init?: RequestInit) {
    const { capabilities } = await this.checkedJson<{
      capabilities: AuthorizationCapabilityDefinition[]
    }>('/api/v1/admin/authorization/capabilities', init)
    return capabilities
  }

  async listRoles(query: { includeArchived?: boolean } = {}, init?: RequestInit) {
    const { roles } = await this.checkedJson<{ roles: AuthorizationRole[] }>(
      this.http.appendQuery('/api/v1/admin/authorization/roles', query),
      init,
    )
    return roles
  }

  createRoleResponse(body: {
    name: string
    description?: string
    capabilities: AuthorizationCapability[]
  }, init?: RequestInit) {
    return this.http.request(
      '/api/v1/admin/authorization/roles',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  updateRoleResponse(body: {
    roleId: string
    name?: string
    description?: string
    capabilities?: AuthorizationCapability[]
  }, init?: RequestInit) {
    return this.http.request(
      '/api/v1/admin/authorization/roles',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  archiveRoleResponse(roleId: string, init?: RequestInit) {
    return this.http.request(
      '/api/v1/admin/authorization/roles',
      this.http.jsonRequest({ roleId }, { ...init, method: 'DELETE' }),
    )
  }

  async listGroups(query: { includeArchived?: boolean } = {}, init?: RequestInit) {
    const { groups } = await this.checkedJson<{ groups: AuthorizationGroup[] }>(
      this.http.appendQuery('/api/v1/admin/authorization/groups', query),
      init,
    )
    return groups
  }

  createGroupResponse(body: { name: string; description?: string }, init?: RequestInit) {
    return this.http.request(
      '/api/v1/admin/authorization/groups',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  updateGroupResponse(body: {
    groupId: string
    name?: string
    description?: string
  }, init?: RequestInit) {
    return this.http.request(
      '/api/v1/admin/authorization/groups',
      this.http.jsonRequest(body, { ...init, method: 'PATCH' }),
    )
  }

  archiveGroupResponse(groupId: string, init?: RequestInit) {
    return this.http.request(
      '/api/v1/admin/authorization/groups',
      this.http.jsonRequest({ groupId }, { ...init, method: 'DELETE' }),
    )
  }

  async listMemberships(groupId: string, init?: RequestInit) {
    const { memberships } = await this.checkedJson<{ memberships: GroupMembership[] }>(
      this.http.appendQuery('/api/v1/admin/authorization/memberships', { groupId }),
      init,
    )
    return memberships
  }

  addMembershipResponse(body: { groupId: string; userId: string }, init?: RequestInit) {
    return this.http.request(
      '/api/v1/admin/authorization/memberships',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  removeMembershipResponse(body: { groupId: string; userId: string }, init?: RequestInit) {
    return this.http.request(
      '/api/v1/admin/authorization/memberships',
      this.http.jsonRequest(body, { ...init, method: 'DELETE' }),
    )
  }

  async listAssignments(query: {
    subjectType: 'user' | 'group'
    subjectId: string
  }, init?: RequestInit) {
    const { assignments } = await this.checkedJson<{ assignments: Assignment[] }>(
      this.http.appendQuery('/api/v1/admin/authorization/assignments', query),
      init,
    )
    return assignments
  }

  assignRoleResponse(body: {
    subjectType: 'user' | 'group'
    subjectId: string
    roleId: string
  }, init?: RequestInit) {
    return this.http.request(
      '/api/v1/admin/authorization/assignments',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  revokeRoleResponse(body: {
    subjectType: 'user' | 'group'
    subjectId: string
    roleId: string
  }, init?: RequestInit) {
    return this.http.request(
      '/api/v1/admin/authorization/assignments',
      this.http.jsonRequest(body, { ...init, method: 'DELETE' }),
    )
  }

  async listResourceGrants(query: {
    resourceType: string
    resourceId: string
  }, init?: RequestInit) {
    const { grants } = await this.checkedJson<{ grants: ResourceGrant[] }>(
      this.http.appendQuery('/api/v1/admin/authorization/grants', query),
      init,
    )
    return grants
  }

  upsertResourceGrantResponse(body: {
    resourceType: string
    resourceId: string
    principalType: AuthorizationPrincipalType
    principalId: string
    accessRole: ResourceAccessRole
  }, init?: RequestInit) {
    return this.http.request(
      '/api/v1/admin/authorization/grants',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  removeResourceGrantResponse(grantId: string, init?: RequestInit) {
    return this.http.request(
      '/api/v1/admin/authorization/grants',
      this.http.jsonRequest({ grantId }, { ...init, method: 'DELETE' }),
    )
  }

  private async checkedJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.http.request(path, init)
    const payload = await response.json().catch(() => ({})) as T & { error?: string }
    if (!response.ok) {
      throw Object.assign(
        new Error(payload.error || 'Authorization administration request failed'),
        { status: response.status },
      )
    }
    return payload
  }
}
