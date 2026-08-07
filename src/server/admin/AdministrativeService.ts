import 'server-only'

import type { AuditService } from './AuditService'
import type {
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
  }) {}

  async canManageAdministrators(userId: string): Promise<boolean> {
    return (await this.activeRole(userId)) === 'admin'
  }

  async canViewAudit(userId: string): Promise<boolean> {
    const role = await this.activeRole(userId)
    return role === 'admin' || role === 'auditor'
  }

  async canManageBilling(userId: string): Promise<boolean> {
    const role = await this.activeRole(userId)
    return role === 'admin' || role === 'billing_admin'
  }

  async canAccessSupportControls(userId: string): Promise<boolean> {
    const role = await this.activeRole(userId)
    return role === 'admin' || role === 'support'
  }

  async assertCanManageAdministrators(userId: string): Promise<void> {
    if (!await this.canManageAdministrators(userId)) throw new AdministrativeAuthorizationError()
  }

  async assertCanViewAudit(userId: string): Promise<void> {
    if (!await this.canViewAudit(userId)) throw new AdministrativeAuthorizationError()
  }

  async list(actorUserId: string) {
    await this.assertCanManageAdministrators(actorUserId)
    return await this.deps.repository.list()
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

  private async activeRole(userId: string): Promise<AdministrativeRole | null> {
    const principal = await this.deps.repository.get({ userId })
    return principal && !principal.revokedAt ? principal.role : null
  }
}
