import 'server-only'

import {
  accessRoleAllows,
  strongestAccessRole,
  type AuthorizationCapability,
  type AuthorizationDecision,
  type AuthorizationRepositories,
  type AuthorizationRole,
  type AuthorizationSubject,
  type ResourceAction,
} from '@overlay/authz-contracts'

export type AuthorizationCapabilityPolicy = {
  isEnabled(capability: AuthorizationCapability): boolean
}

export type AuthorizationServiceDeps = {
  capabilityPolicy?: AuthorizationCapabilityPolicy
  isDeploymentOwner?: (userId: string) => boolean | Promise<boolean>
  repositories: AuthorizationRepositories
}

export type ResourceAuthorizationRequest = {
  action: ResourceAction
  capability: AuthorizationCapability
  ownerUserId?: string
  resourceId: string
  resourceType: string
  userId: string
}

export type ResolvedResourceAuthorizationRequest = Omit<ResourceAuthorizationRequest, 'userId'> & {
  subject: AuthorizationSubject
}

export class AuthorizationDeniedError extends Error {
  readonly statusCode = 403

  constructor(readonly decision: AuthorizationDecision) {
    super('Authorization denied')
    this.name = 'AuthorizationDeniedError'
  }
}

export class AuthorizationService {
  constructor(private readonly deps: AuthorizationServiceDeps) {}

  async resolveSubject(userId: string): Promise<AuthorizationSubject> {
    const [groups, directAssignments, isDeploymentOwner] = await Promise.all([
      this.deps.repositories.groups.listForUser(userId),
      this.deps.repositories.assignments.listForUser(userId),
      this.deps.isDeploymentOwner?.(userId) ?? false,
    ])
    const groupIds = groups.map(({ id }) => id)
    const groupAssignments = await this.deps.repositories.assignments.listForGroups(groupIds)
    const roleIds = [...new Set([
      ...directAssignments.map(({ roleId }) => roleId),
      ...groupAssignments.map(({ roleId }) => roleId),
    ])]
    const roles = (await Promise.all(
      roleIds.map((roleId) => this.deps.repositories.roles.get(roleId)),
    )).filter((role): role is AuthorizationRole => Boolean(role && !role.archivedAt))
    const activeRoleIds = roles.map(({ id }) => id)
    const capabilities = [...new Set(roles.flatMap(({ capabilities: values }) => values))]

    return {
      userId,
      groupIds,
      roleIds: activeRoleIds,
      capabilities,
      isDeploymentOwner: Boolean(isDeploymentOwner),
    }
  }

  async checkCapability(args: {
    capability: AuthorizationCapability
    userId: string
  }): Promise<AuthorizationDecision> {
    const subject = await this.resolveSubject(args.userId)
    return this.checkResolvedCapability(subject, args.capability)
  }

  checkResolvedCapability(
    subject: AuthorizationSubject,
    capability: AuthorizationCapability,
  ): AuthorizationDecision {
    return this.capabilityDecision(subject, capability)
  }

  async assertCapability(args: {
    capability: AuthorizationCapability
    userId: string
  }): Promise<AuthorizationSubject> {
    const subject = await this.resolveSubject(args.userId)
    const decision = this.checkResolvedCapability(subject, args.capability)
    if (!decision.allowed) throw new AuthorizationDeniedError(decision)
    return subject
  }

  async checkResourceAccess(
    args: ResourceAuthorizationRequest,
  ): Promise<AuthorizationDecision> {
    const subject = await this.resolveSubject(args.userId)
    return this.checkResolvedResourceAccess({ ...args, subject })
  }

  async checkResolvedResourceAccess(
    args: ResolvedResourceAuthorizationRequest,
  ): Promise<AuthorizationDecision> {
    const subject = args.subject
    const capability = this.capabilityDecision(subject, args.capability)
    if (!capability.allowed) {
      return {
        ...capability,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        requiredAction: args.action,
      }
    }
    if (subject.isDeploymentOwner) {
      return {
        allowed: true,
        capability: args.capability,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        requiredAction: args.action,
        effectiveAccessRole: 'owner',
        reason: 'deployment_owner',
      }
    }
    if (args.ownerUserId === subject.userId) {
      return {
        allowed: true,
        capability: args.capability,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        requiredAction: args.action,
        effectiveAccessRole: 'owner',
        reason: 'resource_owner',
      }
    }

    const grants = await this.deps.repositories.resourceGrants.listForPrincipals({
      userId: subject.userId,
      groupIds: subject.groupIds,
      roleIds: subject.roleIds,
      resourceType: args.resourceType,
    })
    const effectiveAccessRole = strongestAccessRole(
      grants
        .filter(({ resourceId }) => resourceId === args.resourceId)
        .map(({ accessRole }) => accessRole),
    )
    const allowed = Boolean(
      effectiveAccessRole && accessRoleAllows(effectiveAccessRole, args.action),
    )
    return {
      allowed,
      capability: args.capability,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      requiredAction: args.action,
      effectiveAccessRole,
      reason: allowed ? 'resource_access_granted' : 'resource_access_missing',
    }
  }

  async getResourceOwner(args: { resourceType: string; resourceId: string }): Promise<string | null> {
    return this.deps.repositories.resourceOwners.getOwner(args)
  }

  async listAccessibleResourceIds(args: {
    action: ResourceAction
    resourceType: string
    subject: AuthorizationSubject
  }): Promise<string[]> {
    const grants = await this.deps.repositories.resourceGrants.listForPrincipals({
      userId: args.subject.userId,
      groupIds: args.subject.groupIds,
      roleIds: args.subject.roleIds,
      resourceType: args.resourceType,
    })
    return [...new Set(grants
      .filter(({ accessRole }) => accessRoleAllows(accessRole, args.action))
      .map(({ resourceId }) => resourceId))]
  }

  async listAccessibleResources(args: {
    action: ResourceAction
    resourceType: string
    subject: AuthorizationSubject
  }): Promise<Array<{ ownerUserId: string; resourceId: string }>> {
    const resourceIds = await this.listAccessibleResourceIds(args)
    const values = await Promise.all(resourceIds.map(async (resourceId) => ({
      ownerUserId: await this.getResourceOwner({ resourceId, resourceType: args.resourceType }),
      resourceId,
    })))
    return values.filter((value): value is { ownerUserId: string; resourceId: string } => (
      Boolean(value.ownerUserId) && value.ownerUserId !== args.subject.userId
    ))
  }

  async assertResourceAccess(
    args: ResourceAuthorizationRequest,
  ): Promise<void> {
    const decision = await this.checkResourceAccess(args)
    if (!decision.allowed) throw new AuthorizationDeniedError(decision)
  }

  private capabilityDecision(
    subject: AuthorizationSubject,
    capability: AuthorizationCapability,
  ): AuthorizationDecision {
    if (subject.isDeploymentOwner) {
      return { allowed: true, capability, reason: 'deployment_owner' }
    }
    if (this.deps.capabilityPolicy && !this.deps.capabilityPolicy.isEnabled(capability)) {
      return { allowed: false, capability, reason: 'capability_disabled' }
    }
    if (!subject.capabilities.includes(capability)) {
      return { allowed: false, capability, reason: 'capability_missing' }
    }
    return { allowed: true, capability, reason: 'resource_access_granted' }
  }
}
