import 'server-only'

import type { AuditService } from './AuditService'
import type { AuthorizationCapability, AuthorizationDecision } from '@overlay/authz-contracts'
import type {
  AdministrativePrincipal,
  AdministrativeRepository,
  AdministrativeRole,
} from './AdministrativeRepository'

export class AdministrativeAuthorizationError extends Error {
  constructor(message = 'Administrative authorization required') {
    super(message)
    this.name = 'AdministrativeAuthorizationError'
  }
}

export class AdministrativeService {
  constructor(private readonly deps: {
    audit: AuditService
    repository: AdministrativeRepository
    authorization?: {
      checkCapability(args: {
        capability: AuthorizationCapability
        userId: string
      }): Promise<AuthorizationDecision>
    }
    compatibility?: {
      migrate(principals: AdministrativePrincipal[]): Promise<{
        active: number
        revoked: number
        total: number
      }>
      revokePrincipal(userId: string): Promise<void>
      syncPrincipal(principal: AdministrativePrincipal): Promise<void>
    }
  }) {}

  async canManageAdministrators(userId: string): Promise<boolean> {
    return await this.capabilityOrLegacy(userId, 'roles.manage', ['admin'])
  }

  async canViewUsers(userId: string): Promise<boolean> {
    return await this.capabilityOrLegacy(userId, 'users.read', ['admin'])
  }

  async canViewAudit(userId: string): Promise<boolean> {
    return await this.capabilityOrLegacy(userId, 'audit.read', ['admin', 'auditor'])
  }

  async canManageBilling(userId: string): Promise<boolean> {
    return await this.capabilityOrLegacy(userId, 'usage.manage', ['admin', 'billing_admin'])
  }

  async canViewUsage(userId: string): Promise<boolean> {
    return await this.capabilityOrLegacy(userId, 'usage.read', ['admin', 'billing_admin'])
  }

  async canAccessSupportControls(userId: string): Promise<boolean> {
    return await this.capabilityOrLegacy(userId, 'support.access', ['admin', 'support'])
  }

  async assertCanManageAdministrators(userId: string): Promise<void> {
    if (!await this.canManageAdministrators(userId)) throw new AdministrativeAuthorizationError()
  }

  async assertCanViewAudit(userId: string): Promise<void> {
    if (!await this.canViewAudit(userId)) throw new AdministrativeAuthorizationError()
  }

  async assertCapability(
    userId: string,
    capability: AuthorizationCapability,
  ): Promise<void> {
    if (!await this.capabilityOrLegacy(
      userId,
      capability,
      legacyRolesForCapability(capability),
    )) {
      throw new AdministrativeAuthorizationError()
    }
  }

  async list(actorUserId: string) {
    await this.assertCanManageAdministrators(actorUserId)
    const principals = await this.deps.repository.list()
    await this.syncCompatibility(() => this.deps.compatibility?.migrate(principals), {
      action: 'authorization.compatibility.migrate',
      actorUserId,
      resourceId: 'fixed-administrative-roles',
    })
    return principals
  }

  async grant(args: {
    actorUserId: string
    ipAddress?: string
    reason?: string
    requestId?: string
    role: AdministrativeRole
    userId: string
  }) {
    await this.assertCanManageAdministrators(args.actorUserId)
    const principal = await this.deps.repository.grant({
      grantedBy: args.actorUserId,
      reason: args.reason,
      role: args.role,
      userId: args.userId,
    })
    await this.syncCompatibility(() => this.deps.compatibility?.syncPrincipal(principal), {
      action: 'authorization.compatibility.sync',
      actorUserId: args.actorUserId,
      resourceId: args.userId,
    })
    await this.deps.audit.record({
      action: 'administration.principal.grant',
      actorType: 'user',
      actorUserId: args.actorUserId,
      ipAddress: args.ipAddress,
      metadata: { role: args.role, reason: args.reason },
      outcome: 'success',
      requestId: args.requestId,
      resourceId: args.userId,
      resourceType: 'administrative_principal',
    })
    return principal
  }

  async revoke(args: {
    actorUserId: string
    ipAddress?: string
    requestId?: string
    userId: string
  }): Promise<boolean> {
    await this.assertCanManageAdministrators(args.actorUserId)
    if (args.actorUserId === args.userId) {
      throw new Error('Administrators cannot revoke their own active role')
    }
    const revoked = await this.deps.repository.revoke({
      revokedBy: args.actorUserId,
      userId: args.userId,
    })
    if (revoked) {
      await this.syncCompatibility(() => this.deps.compatibility?.revokePrincipal(args.userId), {
        action: 'authorization.compatibility.revoke',
        actorUserId: args.actorUserId,
        resourceId: args.userId,
      })
    }
    await this.deps.audit.record({
      action: 'administration.principal.revoke',
      actorType: 'user',
      actorUserId: args.actorUserId,
      ipAddress: args.ipAddress,
      outcome: revoked ? 'success' : 'failure',
      requestId: args.requestId,
      resourceId: args.userId,
      resourceType: 'administrative_principal',
    })
    return revoked
  }

  async migrateAuthorizationCompatibility(): Promise<{
    active: number
    revoked: number
    total: number
  }> {
    const principals = await this.deps.repository.list()
    if (!this.deps.compatibility) {
      return {
        active: principals.filter(({ revokedAt }) => !revokedAt).length,
        revoked: principals.filter(({ revokedAt }) => Boolean(revokedAt)).length,
        total: principals.length,
      }
    }
    return await this.deps.compatibility.migrate(principals)
  }

  private async activeRole(userId: string): Promise<AdministrativeRole | null> {
    const principal = await this.deps.repository.get({ userId })
    return principal && !principal.revokedAt ? principal.role : null
  }

  private async capabilityOrLegacy(
    userId: string,
    capability: AuthorizationCapability,
    legacyRoles: AdministrativeRole[],
  ): Promise<boolean> {
    if (this.deps.authorization) {
      try {
        if ((await this.deps.authorization.checkCapability({ capability, userId })).allowed) {
          return true
        }
      } catch (_error) {
        // Legacy authorization remains authoritative until compatibility migration is complete.
      }
    }
    const role = await this.activeRole(userId)
    return Boolean(role && legacyRoles.includes(role))
  }

  private async syncCompatibility(
    operation: () => Promise<unknown> | undefined,
    context: { action: string; actorUserId: string; resourceId: string },
  ): Promise<void> {
    try {
      await operation()
    } catch (error) {
      await this.deps.audit.record({
        action: context.action,
        actorType: 'user',
        actorUserId: context.actorUserId,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
        outcome: 'failure',
        resourceId: context.resourceId,
        resourceType: 'authorization_compatibility',
      })
    }
  }
}

function legacyRolesForCapability(
  capability: AuthorizationCapability,
): AdministrativeRole[] {
  if (capability === 'audit.read') return ['admin', 'auditor']
  if (capability === 'usage.read' || capability === 'usage.manage') {
    return ['admin', 'billing_admin']
  }
  if (capability === 'support.access') return ['admin', 'support']
  return ['admin']
}
