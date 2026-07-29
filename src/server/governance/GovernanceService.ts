import 'server-only'

import { randomUUID } from 'node:crypto'
import type {
  GovernanceAccessReviewStatus,
  GovernancePolicyStatus,
  GovernanceRepository,
  GovernedResourceType,
} from '@overlay/app-core'
import {
  GOVERNANCE_ACCESS_REVIEW_STATUSES,
  GOVERNANCE_POLICY_STATUSES,
  GOVERNED_RESOURCE_TYPES,
} from '@overlay/app-core'
import type {
  AuthorizationCapability,
  AuthorizationRepositories,
} from '@overlay/authz-contracts'
import type { AuditActorType } from '@/server/admin/AuditRepository'
import type { AuditService } from '@/server/admin/AuditService'

export type GovernanceActor = {
  actorApiKeyId?: string
  actorType: AuditActorType
  actorUserId: string
  ipAddress?: string
  requestId?: string
}

export type GovernanceServiceDeps = {
  assertCapability(userId: string, capability: AuthorizationCapability): Promise<void>
  audit: AuditService
  authorization: AuthorizationRepositories
  repository: GovernanceRepository
  now?: () => number
}

export class GovernanceServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message)
    this.name = 'GovernanceServiceError'
  }
}

export class GovernancePolicyBlockedError extends GovernanceServiceError {
  constructor(
    message: string,
    readonly policyId: string,
    readonly reason: 'legal_hold' | 'retention',
  ) {
    super(message, 423)
    this.name = 'GovernancePolicyBlockedError'
  }
}

export class GovernanceService {
  private readonly now: () => number

  constructor(private readonly deps: GovernanceServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  async listPolicies(actor: GovernanceActor, filters: {
    resourceType?: GovernedResourceType
    resourceId?: string
    status?: GovernancePolicyStatus
  } = {}) {
    await this.assertAllowed(actor, 'governance.read')
    return await this.deps.repository.listPolicies(filters)
  }

  async createPolicyVersion(actor: GovernanceActor, input: {
    resourceType: GovernedResourceType
    resourceId: string
    retentionUntil?: number
    legalHold?: boolean
    notes?: string
  }) {
    await this.assertAllowed(actor, 'governance.manage')
    assertResourceType(input.resourceType)
    await this.requireResource(input.resourceType, input.resourceId)
    if (input.retentionUntil !== undefined && input.retentionUntil <= this.now()) {
      throw new GovernanceServiceError('Retention date must be in the future', 400)
    }
    const policy = await this.deps.repository.createPolicyVersion({
      id: randomUUID(),
      resourceType: input.resourceType,
      resourceId: requiredId(input.resourceId),
      retentionUntil: input.retentionUntil,
      legalHold: input.legalHold === true,
      notes: optionalText(input.notes, 2_000),
      createdBy: actor.actorUserId,
    })
    await this.audit(actor, 'governance.policy.create', input.resourceType, input.resourceId, {
      legalHold: policy.legalHold,
      retentionUntil: policy.retentionUntil,
      version: policy.version,
    })
    return policy
  }

  async approvePolicy(actor: GovernanceActor, policyId: string) {
    await this.assertAllowed(actor, 'governance.manage')
    const current = await this.requirePolicy(policyId)
    if (current.status !== 'draft') {
      throw new GovernanceServiceError('Only draft governance policies can be approved', 409)
    }
    if (current.createdBy === actor.actorUserId) {
      throw new GovernanceServiceError(
        'Governance policy approval requires a different administrator',
        409,
      )
    }
    const approved = await this.deps.repository.approvePolicy({
      id: current.id,
      approvedBy: actor.actorUserId,
      approvedAt: this.now(),
    })
    if (!approved) throw new GovernanceServiceError('Governance policy changed before approval', 409)
    await this.audit(
      actor,
      'governance.policy.approve',
      approved.resourceType,
      approved.resourceId,
      { policyId: approved.id, version: approved.version },
    )
    return approved
  }

  async rejectPolicy(actor: GovernanceActor, policyId: string) {
    await this.assertAllowed(actor, 'governance.manage')
    const current = await this.requirePolicy(policyId)
    if (current.status !== 'draft') {
      throw new GovernanceServiceError('Only draft governance policies can be rejected', 409)
    }
    const rejected = await this.deps.repository.rejectPolicy({
      id: current.id,
      rejectedBy: actor.actorUserId,
      rejectedAt: this.now(),
    })
    if (!rejected) throw new GovernanceServiceError('Governance policy changed before rejection', 409)
    await this.audit(
      actor,
      'governance.policy.reject',
      rejected.resourceType,
      rejected.resourceId,
      { policyId: rejected.id, version: rejected.version },
    )
    return rejected
  }

  async assertDeletionAllowed(args: {
    resourceType: GovernedResourceType
    resourceId: string
  }): Promise<void> {
    const policy = await this.deps.repository.getActivePolicy(args)
    if (!policy) return
    if (policy.legalHold) {
      throw new GovernancePolicyBlockedError(
        'This resource is under legal hold and cannot be deleted',
        policy.id,
        'legal_hold',
      )
    }
    if (policy.retentionUntil !== undefined && policy.retentionUntil > this.now()) {
      throw new GovernancePolicyBlockedError(
        `This resource is retained until ${new Date(policy.retentionUntil).toISOString()}`,
        policy.id,
        'retention',
      )
    }
  }

  async createAccessReview(actor: GovernanceActor, input: {
    resourceType: GovernedResourceType
    resourceId: string
    notes?: string
    dueAt?: number
  }) {
    await this.assertAllowed(actor, 'governance.manage')
    assertResourceType(input.resourceType)
    const ownerUserId = await this.requireResource(input.resourceType, input.resourceId)
    if (input.dueAt !== undefined && input.dueAt <= this.now()) {
      throw new GovernanceServiceError('Review due date must be in the future', 400)
    }
    const grants = await this.deps.authorization.resourceGrants.listForResource({
      resourceType: input.resourceType,
      resourceId: input.resourceId,
    })
    const review = await this.deps.repository.createAccessReview({
      id: randomUUID(),
      resourceType: input.resourceType,
      resourceId: requiredId(input.resourceId),
      ownerUserId,
      grants,
      createdBy: actor.actorUserId,
      notes: optionalText(input.notes, 2_000),
      dueAt: input.dueAt,
    })
    await this.audit(
      actor,
      'governance.access_review.create',
      input.resourceType,
      input.resourceId,
      { grantCount: grants.length, reviewId: review.id },
    )
    return review
  }

  async listAccessReviews(actor: GovernanceActor, filters: {
    resourceType?: GovernedResourceType
    resourceId?: string
    status?: GovernanceAccessReviewStatus
  } = {}) {
    await this.assertAllowed(actor, 'governance.read')
    return await this.deps.repository.listAccessReviews(filters)
  }

  async completeAccessReview(actor: GovernanceActor, input: {
    reviewId: string
    notes?: string
  }) {
    await this.assertAllowed(actor, 'governance.manage')
    const current = await this.deps.repository.getAccessReview(requiredId(input.reviewId))
    if (!current) throw new GovernanceServiceError('Access review not found', 404)
    if (current.status !== 'open') {
      throw new GovernanceServiceError('Access review is already completed', 409)
    }
    const review = await this.deps.repository.completeAccessReview({
      id: current.id,
      reviewerUserId: actor.actorUserId,
      notes: optionalText(input.notes, 2_000),
      completedAt: this.now(),
    })
    if (!review) throw new GovernanceServiceError('Access review changed before completion', 409)
    await this.audit(
      actor,
      'governance.access_review.complete',
      review.resourceType,
      review.resourceId,
      { reviewId: review.id },
    )
    return review
  }

  async exportCompliance(actor: GovernanceActor, filters: {
    resourceType?: GovernedResourceType
    resourceId?: string
  } = {}) {
    await this.assertAllowed(actor, 'governance.export')
    const [policies, reviews, auditEvents] = await Promise.all([
      this.deps.repository.listPolicies(filters),
      this.deps.repository.listAccessReviews(filters),
      this.deps.audit.list({
        limit: 1_000,
        resourceType: filters.resourceType,
      }),
    ])
    const filteredAuditEvents = filters.resourceId
      ? auditEvents.filter(({ resourceId }) => resourceId === filters.resourceId)
      : auditEvents
    await this.audit(actor, 'governance.compliance.export', 'governance_export', undefined, {
      policyCount: policies.length,
      reviewCount: reviews.length,
      auditEventCount: filteredAuditEvents.length,
      filters,
    })
    return {
      exportedAt: this.now(),
      policies,
      accessReviews: reviews,
      auditEvents: filteredAuditEvents,
    }
  }

  async removeForDeletedResource(args: {
    resourceType: GovernedResourceType
    resourceId: string
  }): Promise<void> {
    await this.deps.repository.removeForResource(args)
  }

  private async requirePolicy(policyId: string) {
    const policy = await this.deps.repository.getPolicy(requiredId(policyId))
    if (!policy) throw new GovernanceServiceError('Governance policy not found', 404)
    return policy
  }

  private async requireResource(
    resourceType: GovernedResourceType,
    resourceId: string,
  ): Promise<string> {
    const owner = await this.deps.authorization.resourceOwners.getOwner({
      resourceType,
      resourceId: requiredId(resourceId),
    })
    if (!owner) throw new GovernanceServiceError('Governed resource not found', 404)
    return owner
  }

  private async assertAllowed(
    actor: GovernanceActor,
    capability: AuthorizationCapability,
  ): Promise<void> {
    await this.deps.assertCapability(actor.actorUserId, capability)
  }

  private async audit(
    actor: GovernanceActor,
    action: string,
    resourceType: string,
    resourceId: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.audit.record({
      action,
      actorApiKeyId: actor.actorApiKeyId,
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      ipAddress: actor.ipAddress,
      outcome: 'success',
      requestId: actor.requestId,
      resourceType,
      resourceId,
      metadata,
    })
  }
}

export function isGovernedResourceType(value: unknown): value is GovernedResourceType {
  return typeof value === 'string' && (GOVERNED_RESOURCE_TYPES as readonly string[]).includes(value)
}

export function isGovernancePolicyStatus(value: unknown): value is GovernancePolicyStatus {
  return typeof value === 'string' && (GOVERNANCE_POLICY_STATUSES as readonly string[]).includes(value)
}

export function isGovernanceAccessReviewStatus(
  value: unknown,
): value is GovernanceAccessReviewStatus {
  return typeof value === 'string' &&
    (GOVERNANCE_ACCESS_REVIEW_STATUSES as readonly string[]).includes(value)
}

function assertResourceType(value: unknown): asserts value is GovernedResourceType {
  if (!isGovernedResourceType(value)) {
    throw new GovernanceServiceError('resourceType must be project or knowledge_base', 400)
  }
}

function requiredId(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new GovernanceServiceError('Resource ID is required', 400)
  if (normalized.length > 200) throw new GovernanceServiceError('Resource ID is too long', 400)
  return normalized
}

function optionalText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  if (normalized.length > maxLength) {
    throw new GovernanceServiceError(`Text must be ${maxLength} characters or fewer`, 400)
  }
  return normalized
}
