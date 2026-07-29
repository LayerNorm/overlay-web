import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { durableJobs, knowledgeSources, projects, users } from '@/server/database/postgres/schema'
import type { AuthorizationRepositories, AuthorizationSubject } from '@overlay/authz-contracts'
import type { AuthorizationService } from '@/server/authorization/AuthorizationService'
import { KnowledgeBaseService } from './KnowledgeBaseService'
import { KnowledgeSourceIngestionService } from './KnowledgeSourceIngestionService'
import { PostgresCanonicalKnowledgeIndexQueue } from './PostgresCanonicalKnowledgeIndex'
import { createPostgresKnowledgeBaseRepositories } from './PostgresKnowledgeBaseRepositories'
import { ProjectKnowledgeTransferService } from '@/server/projects/ProjectKnowledgeTransferService'
import { readSourceProvenance } from '@/shared/knowledge/source-provenance'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

/**
 * Phase 6 guarantees for a personal brain.
 *
 * The one that matters most: knowledge deliberately promoted out of a project
 * must survive that project being deleted. If it did not, a "brain" would
 * silently lose entries whenever an old engagement was cleaned up, which defeats
 * the point of promoting anything.
 */
test('personal knowledge outlives the project it came from', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const userId = `kb_brain_${randomUUID().replaceAll('-', '')}`
  const projectId = `${userId}_project`
  await db.insert(users).values({ id: userId, email: `${userId}@example.com`, emailVerified: true })

  try {
    const repositories = createPostgresKnowledgeBaseRepositories(db)
    const authorization = permissiveAuthorization(userId)
    const bases = new KnowledgeBaseService({
      authorization,
      authorizationRepositories: emptyAuthorizationRepositories(),
      repositories,
    })
    const ingestion = new KnowledgeSourceIngestionService({
      authorization,
      bases,
      indexQueue: new PostgresCanonicalKnowledgeIndexQueue(db),
      repositories,
    })
    const transfer = new ProjectKnowledgeTransferService({
      bases,
      files: {
        async getFile() {
          return { _id: 'file-1', name: 'Findings.md', textContent: 'Clients prefer self-hosting.' }
        },
      } as never,
      ingestion,
      notes: { async createNote() { return { id: 'note-1' } } },
    })

    await db.insert(projects).values({ id: projectId, userId, name: 'Client Alpha' })

    await t.test('a personal base is created only on explicit request', async () => {
      assert.deepEqual(await bases.listPersonalKnowledgeBases(userId), [])
      const brain = await bases.ensureDefaultPersonalKnowledgeBase({ userId })
      assert.equal(brain.kind, 'personal')
      // Calling again returns the same base rather than creating a second one.
      const again = await bases.ensureDefaultPersonalKnowledgeBase({ userId })
      assert.equal(again.id, brain.id)
      assert.equal((await bases.listPersonalKnowledgeBases(userId)).length, 1)
    })

    const brain = await bases.ensureDefaultPersonalKnowledgeBase({ userId })

    await t.test('promoting from a project records its origin', async () => {
      const promoted = await transfer.promoteProjectFileToKnowledgeBase({
        fileId: 'file-1',
        knowledgeBaseId: brain.id,
        projectId,
        userId,
      })
      assert.equal(promoted.updatedExisting, false)
      const provenance = readSourceProvenance(
        (await repositories.sources.get(promoted.source.id))?.metadata,
      )
      assert.equal(provenance?.origin, 'project-promotion')
      assert.equal(provenance?.promotedFromProjectId, projectId)
    })

    await t.test('re-promoting versions the source instead of failing', async () => {
      // Without namespaced refs and update-on-existing this would violate the
      // unique (owner, kind, source_ref) index rather than return.
      const again = await transfer.promoteProjectFileToKnowledgeBase({
        fileId: 'file-1',
        knowledgeBaseId: brain.id,
        projectId,
        userId,
      })
      assert.equal(again.updatedExisting, true)
      assert.equal((await bases.listSources({ knowledgeBaseId: brain.id, userId })).length, 1)
    })

    await t.test('deleting the project leaves the promoted knowledge intact', async () => {
      const before = await bases.listSources({ knowledgeBaseId: brain.id, userId })
      assert.equal(before.length, 1)
      const promotedSourceId = before[0]!.source.id

      // Hard-delete the originating project, as a project tree delete would.
      await db.delete(projects).where(eq(projects.id, projectId))

      const after = await bases.listSources({ knowledgeBaseId: brain.id, userId })
      assert.equal(after.length, 1, 'promoted knowledge must survive its origin project')
      assert.equal(after[0]!.source.id, promotedSourceId)

      const row = await db.select().from(knowledgeSources)
        .where(eq(knowledgeSources.id, promotedSourceId))
      assert.equal(row.length, 1)
      assert.equal(row[0]!.deletedAt, null, 'the source must not be soft-deleted either')

      // Provenance still names the now-deleted project, which is the point: the
      // reader can tell where it came from even after the origin is gone.
      const provenance = readSourceProvenance(row[0]!.metadata)
      assert.equal(provenance?.promotedFromProjectId, projectId)
    })

    await t.test('a personal base belongs to its owner alone', async () => {
      const otherUserId = `${userId}_other`
      await db.insert(users).values({
        id: otherUserId,
        email: `${otherUserId}@example.com`,
        emailVerified: true,
      })
      try {
        const otherBases = new KnowledgeBaseService({
          authorization: permissiveAuthorization(otherUserId),
          authorizationRepositories: emptyAuthorizationRepositories(),
          repositories,
        })
        // listForOwner is owner-scoped, so another user's brain is simply absent.
        assert.deepEqual(await otherBases.listPersonalKnowledgeBases(otherUserId), [])
      } finally {
        await db.execute(sql`DELETE FROM users WHERE id = ${otherUserId}`)
      }
    })

    await t.test('account deletion removes the brain and its sources', async () => {
      const sourceIds = (await bases.listSources({ knowledgeBaseId: brain.id, userId }))
        .map(({ source }) => source.id)
      assert.ok(sourceIds.length > 0)

      await db.execute(sql`DELETE FROM users WHERE id = ${userId}`)

      const remainingBases = await repositories.bases.listForOwner(userId)
      assert.deepEqual(remainingBases, [], 'personal bases must be removed with the account')
      for (const sourceId of sourceIds) {
        assert.equal(await repositories.sources.get(sourceId), null)
      }
    })
  } finally {
    await db.execute(sql`DELETE FROM users WHERE id = ${userId}`)
    await db.delete(durableJobs).where(sql`${durableJobs.payload}->>'userId' = ${userId}`)
    await pool.end()
  }
})

function permissiveAuthorization(userId: string): AuthorizationService {
  const subject: AuthorizationSubject = {
    userId,
    isDeploymentOwner: false,
    capabilities: [
      'knowledge.create', 'knowledge.read', 'knowledge.edit', 'knowledge.delete',
      'conversations.read', 'conversations.edit',
    ],
    groupIds: [],
    roleIds: [],
  }
  return {
    assertCapability: async () => subject,
    assertResourceAccess: async () => subject,
    checkResolvedResourceAccess: async () => ({ allowed: true, reason: 'owner' }),
    getResourceOwner: async () => userId,
    listAccessibleResourceIds: async () => [],
    resolveSubject: async () => subject,
  } as unknown as AuthorizationService
}

function emptyAuthorizationRepositories(): AuthorizationRepositories {
  return {
    resourceGrants: {
      listForResource: async () => [],
      remove: async () => false,
    },
  } as unknown as AuthorizationRepositories
}
