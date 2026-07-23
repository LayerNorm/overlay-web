import 'server-only'

import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createConvexAuthorizationRepositories } from './ConvexAuthorizationRepositories'
import { runAuthorizationRepositoryContract } from './authorization-repository-contract'
import { ConvexUserRepository } from '@/server/users/ConvexUserRepository'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ConvexProjectRepository } from '@/server/projects/ConvexProjectRepository'
import assert from 'node:assert/strict'

const enabled = process.env.AUTHORIZATION_CONTRACT_CONVEX === '1'
const hasConvexUrl = Boolean(process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('real Convex authorization repository contract and account cleanup', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set AUTHORIZATION_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async (t) => {
  const scope = `authz_${randomUUID().replaceAll('-', '')}`
  const users = new ConvexUserRepository()
  await runAuthorizationRepositoryContract(t, {
    repositories: createConvexAuthorizationRepositories(),
    scope,
    createUser: async (userId) => {
      await users.upsertFromIdentity({
        identity: { provider: 'workos', subject: userId, email: `${userId}@example.com` },
        user: { id: userId, email: `${userId}@example.com`, emailVerified: true },
        now: new Date(),
      })
    },
    cleanupUser: async (userId) => {
      await convex.mutation('auth/users:deleteUserAccountByServer', {
        serverSecret: getInternalApiSecret(),
        userId,
      }, { throwOnError: true })
    },
  })
  await t.test('resolves resource ownership without trusting a caller user id', async () => {
    const ownerUserId = `${scope}_owner`
    await users.upsertFromIdentity({
      identity: { provider: 'workos', subject: ownerUserId, email: `${ownerUserId}@example.com` },
      user: { id: ownerUserId, email: `${ownerUserId}@example.com`, emailVerified: true },
      now: new Date(),
    })
    const project = await new ConvexProjectRepository().createProject({
      userId: ownerUserId,
      name: 'Owned project',
    })
    const repositories = createConvexAuthorizationRepositories()
    assert.equal(await repositories.resourceOwners.getOwner({
      resourceType: 'project',
      resourceId: project._id,
    }), ownerUserId)
    await convex.mutation('auth/users:deleteUserAccountByServer', {
      serverSecret: getInternalApiSecret(),
      userId: ownerUserId,
    }, { throwOnError: true })
  })
})
