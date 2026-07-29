import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { PostgresAccountDataDeletionRepository } from '@/server/account/PostgresAccountDataDeletionRepository'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { users } from '@/server/database/postgres/schema'
import { createPostgresKnowledgeBaseRepositories } from '@/server/knowledge-bases'
import { PostgresGovernanceRepository } from './PostgresGovernanceRepository'
import { runGovernanceRepositoryContract } from './governance-repository-contract'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('real Postgres governance repository contract and account cleanup', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres governance contracts',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const repository = new PostgresGovernanceRepository(db)
  const knowledge = createPostgresKnowledgeBaseRepositories(db)
  const deletion = new PostgresAccountDataDeletionRepository(db)
  const scope = `governance_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_owner`
  const reviewerUserId = `${scope}_reviewer`
  const knowledgeBaseId = `${scope}_base`

  try {
    await db.insert(users).values([
      { id: ownerUserId, email: `${ownerUserId}@example.com`, emailVerified: true },
      { id: reviewerUserId, email: `${reviewerUserId}@example.com`, emailVerified: true },
    ])
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
      const result = await deletion.deleteUserAccount({ userId: ownerUserId })
      assert.equal(result.verification.orphanedRowCount, 0)
      assert.equal(result.verification.remainingRowsByTable.governancePolicies, 0)
      assert.equal((await repository.getPolicy(policy.id))?.createdBy, undefined)
      await repository.removeForResource({
        resourceType: 'knowledge_base',
        resourceId: reviewerBaseId,
      })
    })
  } finally {
    await deletion.deleteUserAccount({ userId: ownerUserId }).catch(() => undefined)
    await deletion.deleteUserAccount({ userId: reviewerUserId }).catch(() => undefined)
    await pool.end()
  }
})
