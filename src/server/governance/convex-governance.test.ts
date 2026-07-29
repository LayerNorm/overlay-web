import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { createConvexKnowledgeBaseRepositories } from '@/server/knowledge-bases'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ConvexUserRepository } from '@/server/users/ConvexUserRepository'
import { ConvexGovernanceRepository } from './ConvexGovernanceRepository'
import { runGovernanceRepositoryContract } from './governance-repository-contract'

const enabled = process.env.GOVERNANCE_CONTRACT_CONVEX === '1'
const hasConvexUrl = Boolean(process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('real Convex governance repository contract and account cleanup', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set GOVERNANCE_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async (t) => {
  const scope = `governance_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_owner`
  const reviewerUserId = `${scope}_reviewer`
  const knowledgeBaseId = `${scope}_base`
  const users = new ConvexUserRepository()
  const repository = new ConvexGovernanceRepository()
  const knowledge = createConvexKnowledgeBaseRepositories()

  async function createUser(userId: string) {
    await users.upsertFromIdentity({
      identity: { provider: 'workos', subject: userId, email: `${userId}@example.com` },
      user: { id: userId, email: `${userId}@example.com`, emailVerified: true },
      now: new Date(),
    })
  }

  async function deleteUser(userId: string) {
    return await convex.mutation<{
      deletedRowCount: number
    }>('auth/users:deleteUserAccountByServer', {
      serverSecret: getInternalApiSecret(),
      userId,
    }, { throwOnError: true })
  }

  try {
    await createUser(ownerUserId)
    await createUser(reviewerUserId)
    await knowledge.bases.create({
      id: knowledgeBaseId,
      ownerUserId,
      title: 'Governance contract base',
      createdBy: ownerUserId,
    })
    await runGovernanceRepositoryContract(t, {
      repository,
      resourceId: knowledgeBaseId,
      resourceType: 'knowledge_base',
      reviewerUserId,
      scope,
      userId: ownerUserId,
    })

    await t.test('preserves policy evidence when its author leaves', async () => {
      const reviewerBaseId = `${scope}_reviewer_base`
      await knowledge.bases.create({
        id: reviewerBaseId,
        ownerUserId: reviewerUserId,
        title: 'Retained evidence',
        createdBy: reviewerUserId,
      })
      const policy = await repository.createPolicyVersion({
        id: `${scope}_retained_policy`,
        resourceType: 'knowledge_base',
        resourceId: reviewerBaseId,
        legalHold: false,
        createdBy: ownerUserId,
      })
      const result = await deleteUser(ownerUserId)
      assert.ok(result)
      assert.ok(result.deletedRowCount > 0)
      assert.equal((await repository.getPolicy(policy.id))?.createdBy, undefined)
      await repository.removeForResource({
        resourceType: 'knowledge_base',
        resourceId: reviewerBaseId,
      })
    })
  } finally {
    await deleteUser(ownerUserId).catch(() => undefined)
    await deleteUser(reviewerUserId).catch(() => undefined)
  }
})
