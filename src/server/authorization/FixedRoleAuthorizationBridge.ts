import 'server-only'

import {
  AUTHORIZATION_CAPABILITIES,
  type AuthorizationCapability,
  type AuthorizationRepositories,
} from '@overlay/authz-contracts'
import type {
  AdministrativePrincipal,
  AdministrativeRole,
} from '@/server/admin/AdministrativeRepository'

export const FIXED_AUTHORIZATION_ROLE_IDS: Record<AdministrativeRole, string> = {
  admin: 'system:administrator',
  auditor: 'system:auditor',
  billing_admin: 'system:billing-administrator',
  support: 'system:support',
}

export const MEMBER_AUTHORIZATION_ROLE_ID = 'system:member'

export const MEMBER_AUTHORIZATION_CAPABILITIES: AuthorizationCapability[] = [
  'knowledge.create',
  'knowledge.read',
  'knowledge.edit',
  'knowledge.share',
  'knowledge.delete',
  'conversations.create',
  'conversations.read',
  'conversations.edit',
  'conversations.share',
  'conversations.delete',
  'projects.create',
  'projects.read',
  'projects.edit',
  'projects.share',
  'projects.delete',
  'files.upload',
  'files.read',
  'files.edit',
  'files.share',
  'files.delete',
  'notes.create',
  'notes.read',
  'notes.edit',
  'notes.delete',
  'outputs.read',
  'outputs.delete',
  'models.use',
  'tools.use',
  'integrations.use',
  'skills.use',
  'mcp.use',
  'web_search.use',
  'memory.use',
  'automations.use',
  'api_keys.manage',
  'webhooks.manage',
]

export const FIXED_AUTHORIZATION_ROLE_DEFINITIONS: Record<AdministrativeRole, {
  name: string
  description: string
  capabilities: AuthorizationCapability[]
}> = {
  admin: {
    name: '[System] Administrator',
    description: 'Built-in compatibility role with every authorization capability.',
    capabilities: [...AUTHORIZATION_CAPABILITIES],
  },
  auditor: {
    name: '[System] Auditor',
    description: 'Built-in compatibility role for read-only governance and audit access.',
    capabilities: [
      'administration.access',
      'users.read',
      'groups.read',
      'roles.read',
      'audit.read',
    ],
  },
  billing_admin: {
    name: '[System] Billing administrator',
    description: 'Built-in compatibility role for usage and budget administration.',
    capabilities: [
      'administration.access',
      'users.read',
      'usage.read',
      'usage.manage',
    ],
  },
  support: {
    name: '[System] Support',
    description: 'Built-in compatibility role for support controls.',
    capabilities: ['administration.access', 'users.read', 'support.access'],
  },
}

export class FixedRoleAuthorizationBridge {
  private systemRolesReady?: Promise<void>

  constructor(private readonly repositories: AuthorizationRepositories) {}

  async ensureSystemRoles(): Promise<void> {
    this.systemRolesReady ??= this.initializeSystemRoles().catch((error) => {
      this.systemRolesReady = undefined
      throw error
    })
    await this.systemRolesReady
  }

  private async initializeSystemRoles(): Promise<void> {
    await this.ensureMemberRole()
    for (const role of Object.keys(FIXED_AUTHORIZATION_ROLE_IDS) as AdministrativeRole[]) {
      await this.ensureSystemRole(role)
    }
  }

  async ensureDefaultUserRole(userId: string, assignedBy?: string): Promise<void> {
    await this.ensureSystemRoles()
    const existingAssignments = await this.repositories.assignments.listForUser(userId)
    const compatibilityRoleIds = new Set(Object.values(FIXED_AUTHORIZATION_ROLE_IDS))
    if (existingAssignments.some(({ roleId }) => !compatibilityRoleIds.has(roleId))) return
    await this.repositories.assignments.assignUser({
      userId,
      roleId: MEMBER_AUTHORIZATION_ROLE_ID,
      assignedBy,
    })
  }

  async syncPrincipal(principal: AdministrativePrincipal): Promise<void> {
    await this.ensureSystemRoles()
    await this.ensureDefaultUserRole(principal.userId, principal.grantedBy)
    await this.revokeCompatibilityAssignments(principal.userId)
    if (principal.revokedAt) return
    await this.repositories.assignments.assignUser({
      userId: principal.userId,
      roleId: FIXED_AUTHORIZATION_ROLE_IDS[principal.role],
      assignedBy: principal.grantedBy,
    })
  }

  async revokePrincipal(userId: string): Promise<void> {
    await this.revokeCompatibilityAssignments(userId)
  }

  async migrate(principals: AdministrativePrincipal[]): Promise<{
    active: number
    revoked: number
    total: number
  }> {
    await this.ensureSystemRoles()
    let active = 0
    let revoked = 0
    for (const principal of principals) {
      await this.syncPrincipal(principal)
      if (principal.revokedAt) revoked += 1
      else active += 1
    }
    return { active, revoked, total: principals.length }
  }

  async migrateUsers(userIds: readonly string[]): Promise<number> {
    await this.ensureSystemRoles()
    for (const userId of new Set(userIds.filter(Boolean))) {
      await this.ensureDefaultUserRole(userId)
    }
    return new Set(userIds.filter(Boolean)).size
  }

  private async ensureMemberRole(): Promise<void> {
    const definition = {
      name: '[System] Default member',
      description: 'Built-in baseline role for authenticated Overlay product access.',
      capabilities: MEMBER_AUTHORIZATION_CAPABILITIES,
    }
    let existing = await this.repositories.roles.get(MEMBER_AUTHORIZATION_ROLE_ID)
    if (!existing) {
      try {
        await this.repositories.roles.create({
          id: MEMBER_AUTHORIZATION_ROLE_ID,
          ...definition,
          isSystem: true,
        })
        return
      } catch (error) {
        existing = await this.repositories.roles.get(MEMBER_AUTHORIZATION_ROLE_ID)
        if (!existing) throw error
      }
    }
    if (!existing.isSystem) {
      throw new Error(`Reserved authorization role ID ${MEMBER_AUTHORIZATION_ROLE_ID} is not a system role`)
    }
    if (
      existing.name === definition.name &&
      existing.description === definition.description &&
      sameCapabilities(existing.capabilities, definition.capabilities)
    ) {
      return
    }
    await this.repositories.roles.update({
      id: MEMBER_AUTHORIZATION_ROLE_ID,
      ...definition,
    })
  }

  private async ensureSystemRole(role: AdministrativeRole): Promise<void> {
    const id = FIXED_AUTHORIZATION_ROLE_IDS[role]
    const definition = FIXED_AUTHORIZATION_ROLE_DEFINITIONS[role]
    let existing = await this.repositories.roles.get(id)
    if (!existing) {
      try {
        await this.repositories.roles.create({
          id,
          ...definition,
          isSystem: true,
        })
        return
      } catch (error) {
        existing = await this.repositories.roles.get(id)
        if (!existing) throw error
      }
    }
    if (!existing?.isSystem) {
      throw new Error(`Reserved authorization role ID ${id} is not a system role`)
    }
    if (
      existing.name === definition.name &&
      existing.description === definition.description &&
      sameCapabilities(existing.capabilities, definition.capabilities)
    ) {
      return
    }
    await this.repositories.roles.update({
      id,
      name: definition.name,
      description: definition.description,
      capabilities: definition.capabilities,
    })
  }

  private async revokeCompatibilityAssignments(userId: string): Promise<void> {
    await Promise.all(Object.values(FIXED_AUTHORIZATION_ROLE_IDS).map((roleId) => (
      this.repositories.assignments.revokeUser({ userId, roleId })
    )))
  }
}

function sameCapabilities(
  left: readonly AuthorizationCapability[],
  right: readonly AuthorizationCapability[],
): boolean {
  return left.length === right.length && left.every((capability) => right.includes(capability))
}
