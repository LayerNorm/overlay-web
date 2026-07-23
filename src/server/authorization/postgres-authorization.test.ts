import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { sql } from 'drizzle-orm'
import { PostgresAccountDataDeletionRepository } from '@/server/account/PostgresAccountDataDeletionRepository'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { projects, users } from '@/server/database/postgres/schema'
import { createPostgresAuthorizationRepositories } from './PostgresAuthorizationRepositories'
import { runAuthorizationRepositoryContract } from './authorization-repository-contract'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('real Postgres authorization repository contract and account cleanup', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres authorization contracts',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const repositories = createPostgresAuthorizationRepositories(db)
  const deletion = new PostgresAccountDataDeletionRepository(db)
  const scope = `authz_${randomUUID().replaceAll('-', '')}`

  try {
    await runAuthorizationRepositoryContract(t, {
      repositories,
      scope,
      createUser: async (userId) => {
        await db.insert(users).values({ id: userId, email: `${userId}@example.com`, emailVerified: true })
      },
      cleanupUser: async (userId) => {
        const result = await deletion.deleteUserAccount({ userId })
        assert.equal(result.verification.orphanedRowCount, 0)
        assert.equal(result.verification.remainingRowsByTable.authorizationGroupMemberships, 0)
        assert.equal(result.verification.remainingRowsByTable.authorizationUserRoles, 0)
        assert.equal(result.verification.remainingRowsByTable.authorizationResourceGrants, 0)
      },
    })
    await t.test('resolves resource ownership without trusting a caller user id', async () => {
      const ownerUserId = `${scope}_owner`
      const projectId = `${scope}_project`
      await db.insert(users).values({ id: ownerUserId, email: `${ownerUserId}@example.com`, emailVerified: true })
      await db.insert(projects).values({ id: projectId, userId: ownerUserId, name: 'Owned project' })
      assert.equal(await repositories.resourceOwners.getOwner({
        resourceType: 'project',
        resourceId: projectId,
      }), ownerUserId)
      assert.equal(await repositories.resourceOwners.getOwner({
        resourceType: 'project',
        resourceId: `${projectId}_missing`,
      }), null)
      await deletion.deleteUserAccount({ userId: ownerUserId })
    })
  } finally {
    await db.execute(sql`DELETE FROM authorization_roles WHERE id LIKE ${`${scope}%`}`)
    await db.execute(sql`DELETE FROM authorization_groups WHERE id LIKE ${`${scope}%`}`)
    await db.execute(sql`DELETE FROM users WHERE id LIKE ${`${scope}%`}`)
    await pool.end()
  }
})
