import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  CreateGovernanceAccessReviewInput,
  CreateGovernancePolicyVersionInput,
  GovernanceAccessReview,
  GovernancePolicy,
  GovernanceRepository,
} from '@overlay/app-core'
import type {
  AuthorizationCapability,
  AuthorizationRepositories,
  ResourceGrant,
} from '@overlay/authz-contracts'
import type { AuditEventRecord, AuditRepository } from '@/server/admin/AuditRepository'
import { AuditService } from '@/server/admin/AuditService'
import {
  GovernancePolicyBlockedError,
  GovernanceService,
  GovernanceServiceError,
  type GovernanceActor,
} from './GovernanceService'

const admin: GovernanceActor = {
  actorType: 'user',
  actorUserId: 'admin_1',
  requestId: 'request_1',
}
const reviewer: GovernanceActor = {
  actorType: 'user',
  actorUserId: 'admin_2',
  requestId: 'request_2',
}

test('governance policies require maker-checker approval and block protected deletion', async () => {
  const fixture = createFixture()
  fixture.owners.set('knowledge_base:kb_1', 'owner_1')
  const policy = await fixture.service.createPolicyVersion(admin, {
    resourceType: 'knowledge_base',
    resourceId: 'kb_1',
    retentionUntil: 20_000,
    legalHold: true,
    notes: 'Regulatory evidence',
  })
  assert.equal(policy.status, 'draft')
  assert.equal(policy.version, 1)

  await assert.rejects(
    fixture.service.approvePolicy(admin, policy.id),
    (error: unknown) => error instanceof GovernanceServiceError &&
      error.message.includes('different administrator'),
  )
  const active = await fixture.service.approvePolicy(reviewer, policy.id)
  assert.equal(active.status, 'active')
  assert.equal(active.approvedBy, 'admin_2')

  await assert.rejects(
    fixture.service.assertDeletionAllowed({
      resourceType: 'knowledge_base',
      resourceId: 'kb_1',
    }),
    (error: unknown) => error instanceof GovernancePolicyBlockedError &&
      error.reason === 'legal_hold',
  )

  const replacement = await fixture.service.createPolicyVersion(admin, {
    resourceType: 'knowledge_base',
    resourceId: 'kb_1',
    legalHold: false,
  })
  assert.equal(replacement.version, 2)
  await fixture.service.approvePolicy(reviewer, replacement.id)
  assert.equal((await fixture.repository.getPolicy(active.id))?.status, 'superseded')
  await fixture.service.assertDeletionAllowed({
    resourceType: 'knowledge_base',
    resourceId: 'kb_1',
  })
  assert.deepEqual(
    fixture.events.map(({ action }) => action),
    [
      'governance.policy.create',
      'governance.policy.approve',
      'governance.policy.create',
      'governance.policy.approve',
    ],
  )
})

test('access reviews snapshot grants and compliance exports include immutable evidence', async () => {
  const fixture = createFixture()
  fixture.owners.set('project:project_1', 'owner_1')
  fixture.grants.push({
    id: 'grant_1',
    resourceType: 'project',
    resourceId: 'project_1',
    principalType: 'group',
    principalId: 'group_1',
    accessRole: 'viewer',
    createdAt: 1,
    updatedAt: 1,
  })
  const review = await fixture.service.createAccessReview(admin, {
    resourceType: 'project',
    resourceId: 'project_1',
    dueAt: 30_000,
    notes: 'Quarterly owner review',
  })
  assert.equal(review.ownerUserId, 'owner_1')
  assert.deepEqual(review.grants, fixture.grants)

  fixture.grants.length = 0
  const completed = await fixture.service.completeAccessReview(reviewer, {
    reviewId: review.id,
    notes: 'Access remains appropriate',
  })
  assert.equal(completed.status, 'completed')
  assert.equal(completed.grants.length, 1, 'review evidence must remain a snapshot')

  const evidence = await fixture.service.exportCompliance(reviewer, {
    resourceType: 'project',
    resourceId: 'project_1',
  })
  assert.equal(evidence.accessReviews.length, 1)
  assert.equal(evidence.auditEvents.some(({ action }) =>
    action === 'governance.access_review.create'), true)
  assert.equal(fixture.capabilities.includes('governance.export'), true)
})

test('governance rejects missing resources, past dates, and repeated decisions', async () => {
  const fixture = createFixture()
  await assert.rejects(
    fixture.service.createPolicyVersion(admin, {
      resourceType: 'project',
      resourceId: 'missing',
    }),
    (error: unknown) => error instanceof GovernanceServiceError && error.statusCode === 404,
  )
  fixture.owners.set('project:project_1', 'owner_1')
  await assert.rejects(
    fixture.service.createPolicyVersion(admin, {
      resourceType: 'project',
      resourceId: 'project_1',
      retentionUntil: 9_999,
    }),
    (error: unknown) => error instanceof GovernanceServiceError && error.statusCode === 400,
  )
  const draft = await fixture.service.createPolicyVersion(admin, {
    resourceType: 'project',
    resourceId: 'project_1',
  })
  await fixture.service.rejectPolicy(reviewer, draft.id)
  await assert.rejects(
    fixture.service.rejectPolicy(reviewer, draft.id),
    (error: unknown) => error instanceof GovernanceServiceError && error.statusCode === 409,
  )
})

function createFixture() {
  const repository = new MemoryGovernanceRepository()
  const events: AuditEventRecord[] = []
  const grants: ResourceGrant[] = []
  const owners = new Map<string, string>()
  const capabilities: AuthorizationCapability[] = []
  const auditRepository: AuditRepository = {
    async append(args) {
      const event = {
        ...args,
        id: args.id ?? `audit_${events.length + 1}`,
        createdAt: args.createdAt ?? 10_000,
      }
      events.push(event)
      return event
    },
    async list(args = {}) {
      return events
        .filter((event) => !args.resourceType || event.resourceType === args.resourceType)
        .slice(0, args.limit ?? events.length)
    },
  }
  const authorization = {
    resourceGrants: {
      async listForResource(args: { resourceType: string; resourceId: string }) {
        return grants.filter((grant) =>
          grant.resourceType === args.resourceType && grant.resourceId === args.resourceId)
      },
    },
    resourceOwners: {
      async getOwner(args: { resourceType: string; resourceId: string }) {
        return owners.get(`${args.resourceType}:${args.resourceId}`) ?? null
      },
    },
  } as AuthorizationRepositories
  const service = new GovernanceService({
    repository,
    authorization,
    audit: new AuditService(auditRepository),
    async assertCapability(_userId, capability) {
      capabilities.push(capability)
    },
    now: () => 10_000,
  })
  return { capabilities, events, grants, owners, repository, service }
}

class MemoryGovernanceRepository implements GovernanceRepository {
  private readonly policies: GovernancePolicy[] = []
  private readonly reviews: GovernanceAccessReview[] = []

  async createPolicyVersion(input: CreateGovernancePolicyVersionInput) {
    const now = 10_000
    const policy: GovernancePolicy = {
      ...input,
      version: Math.max(
        0,
        ...this.policies
          .filter((item) =>
            item.resourceType === input.resourceType && item.resourceId === input.resourceId)
          .map(({ version }) => version),
      ) + 1,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
    this.policies.push(policy)
    return policy
  }

  async getPolicy(id: string) {
    return this.policies.find((policy) => policy.id === id) ?? null
  }

  async getActivePolicy(args: { resourceType: 'project' | 'knowledge_base'; resourceId: string }) {
    return this.policies.find((policy) =>
      policy.resourceType === args.resourceType &&
      policy.resourceId === args.resourceId &&
      policy.status === 'active') ?? null
  }

  async listPolicies(args: Parameters<GovernanceRepository['listPolicies']>[0] = {}) {
    return this.policies.filter((policy) =>
      (!args?.resourceType || policy.resourceType === args.resourceType) &&
      (!args?.resourceId || policy.resourceId === args.resourceId) &&
      (!args?.status || policy.status === args.status))
  }

  async approvePolicy(args: Parameters<GovernanceRepository['approvePolicy']>[0]) {
    const target = this.policies.find((policy) => policy.id === args.id)
    if (!target || target.status !== 'draft') return null
    for (const policy of this.policies) {
      if (
        policy.resourceType === target.resourceType &&
        policy.resourceId === target.resourceId &&
        policy.status === 'active'
      ) {
        policy.status = 'superseded'
        policy.updatedAt = args.approvedAt
      }
    }
    Object.assign(target, {
      status: 'active',
      approvedBy: args.approvedBy,
      approvedAt: args.approvedAt,
      updatedAt: args.approvedAt,
    } satisfies Partial<GovernancePolicy>)
    return target
  }

  async rejectPolicy(args: Parameters<GovernanceRepository['rejectPolicy']>[0]) {
    const target = this.policies.find((policy) => policy.id === args.id)
    if (!target || target.status !== 'draft') return null
    Object.assign(target, {
      status: 'rejected',
      rejectedBy: args.rejectedBy,
      rejectedAt: args.rejectedAt,
      updatedAt: args.rejectedAt,
    } satisfies Partial<GovernancePolicy>)
    return target
  }

  async createAccessReview(input: CreateGovernanceAccessReviewInput) {
    const review: GovernanceAccessReview = {
      ...input,
      grants: structuredClone(input.grants),
      status: 'open',
      createdAt: 10_000,
    }
    this.reviews.push(review)
    return review
  }

  async getAccessReview(id: string) {
    return this.reviews.find((review) => review.id === id) ?? null
  }

  async listAccessReviews(
    args: Parameters<GovernanceRepository['listAccessReviews']>[0] = {},
  ) {
    return this.reviews.filter((review) =>
      (!args?.resourceType || review.resourceType === args.resourceType) &&
      (!args?.resourceId || review.resourceId === args.resourceId) &&
      (!args?.status || review.status === args.status))
  }

  async completeAccessReview(
    args: Parameters<GovernanceRepository['completeAccessReview']>[0],
  ) {
    const target = this.reviews.find((review) => review.id === args.id)
    if (!target || target.status !== 'open') return null
    Object.assign(target, {
      status: 'completed',
      reviewerUserId: args.reviewerUserId,
      notes: args.notes ?? target.notes,
      completedAt: args.completedAt,
    } satisfies Partial<GovernanceAccessReview>)
    return target
  }

  async removeForResource(args: { resourceType: 'project' | 'knowledge_base'; resourceId: string }) {
    for (let index = this.policies.length - 1; index >= 0; index -= 1) {
      const policy = this.policies[index]
      if (policy?.resourceType === args.resourceType && policy.resourceId === args.resourceId) {
        this.policies.splice(index, 1)
      }
    }
    for (let index = this.reviews.length - 1; index >= 0; index -= 1) {
      const review = this.reviews[index]
      if (review?.resourceType === args.resourceType && review.resourceId === args.resourceId) {
        this.reviews.splice(index, 1)
      }
    }
  }
}
