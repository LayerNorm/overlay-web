import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import type { GovernanceRepository } from '@overlay/app-core'

export async function runGovernanceRepositoryContract(
  t: TestContext,
  args: {
    repository: GovernanceRepository
    resourceId: string
    resourceType: 'knowledge_base' | 'project'
    scope: string
    userId: string
    reviewerUserId: string
  },
): Promise<void> {
  let firstPolicyId = ''
  let secondPolicyId = ''
  let reviewId = ''

  await t.test('versions and approves governance policies atomically', async () => {
    const first = await args.repository.createPolicyVersion({
      id: `${args.scope}_policy_1`,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      retentionUntil: 20_000,
      legalHold: true,
      notes: 'Initial policy',
      createdBy: args.userId,
    })
    firstPolicyId = first.id
    const second = await args.repository.createPolicyVersion({
      id: `${args.scope}_policy_2`,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      legalHold: false,
      createdBy: args.userId,
    })
    secondPolicyId = second.id
    assert.equal(first.version, 1)
    assert.equal(second.version, 2)

    const approvedFirst = await args.repository.approvePolicy({
      id: first.id,
      approvedBy: args.reviewerUserId,
      approvedAt: 30_000,
    })
    assert.equal(approvedFirst?.status, 'active')
    const approvedSecond = await args.repository.approvePolicy({
      id: second.id,
      approvedBy: args.reviewerUserId,
      approvedAt: 40_000,
    })
    assert.equal(approvedSecond?.status, 'active')
    assert.equal((await args.repository.getPolicy(first.id))?.status, 'superseded')
    assert.equal((await args.repository.getActivePolicy({
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    }))?.id, second.id)
    assert.equal((await args.repository.listPolicies({
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    })).length, 2)
  })

  await t.test('rejects drafts without changing the active version', async () => {
    const draft = await args.repository.createPolicyVersion({
      id: `${args.scope}_policy_3`,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      legalHold: false,
      createdBy: args.userId,
    })
    const rejected = await args.repository.rejectPolicy({
      id: draft.id,
      rejectedBy: args.reviewerUserId,
      rejectedAt: 50_000,
    })
    assert.equal(rejected?.status, 'rejected')
    assert.equal((await args.repository.getActivePolicy({
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    }))?.id, secondPolicyId)
  })

  await t.test('persists immutable ACL evidence through review completion', async () => {
    const review = await args.repository.createAccessReview({
      id: `${args.scope}_review`,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      ownerUserId: args.userId,
      grants: [{
        id: `${args.scope}_grant`,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        principalType: 'user',
        principalId: args.reviewerUserId,
        accessRole: 'viewer',
        createdAt: 1,
        updatedAt: 1,
      }],
      createdBy: args.userId,
      dueAt: 60_000,
    })
    reviewId = review.id
    const completed = await args.repository.completeAccessReview({
      id: review.id,
      reviewerUserId: args.reviewerUserId,
      notes: 'Approved',
      completedAt: 55_000,
    })
    assert.equal(completed?.status, 'completed')
    assert.equal(completed?.grants.length, 1)
    assert.equal((await args.repository.listAccessReviews({
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      status: 'completed',
    })).length, 1)
  })

  await t.test('removes all governance records with the governed resource', async () => {
    assert.ok(firstPolicyId)
    assert.ok(reviewId)
    await args.repository.removeForResource({
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    })
    assert.equal(await args.repository.getPolicy(firstPolicyId), null)
    assert.equal(await args.repository.getAccessReview(reviewId), null)
  })
}
