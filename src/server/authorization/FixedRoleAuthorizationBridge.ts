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
  constructor(private readonly repositories: AuthorizationRepositories) {}

  async ensureSystemRoles(): Promise<void> {
    for (const role of Object.keys(FIXED_AUTHORIZATION_ROLE_IDS) as AdministrativeRole[]) {
      await this.ensureSystemRole(role)
    }
  }

  async syncPrincipal(principal: AdministrativePrincipal): Promise<void> {
    await this.ensureSystemRoles()
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
