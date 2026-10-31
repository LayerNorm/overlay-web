import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { FREE_PLAN_STORAGE_BYTES } from '../src/shared/billing/billing-pricing'
import { fileKeyPrefixForUser } from '../src/shared/storage/storage-keys'

const modules = import.meta.glob('./**/*.ts')
const secret = 'file-publication-test-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })
const commit = makeFunctionReference<'mutation'>('files/files:commitUploadByServer')
const input = { userId: 'user_1', serverSecret: secret, name: 'film.mp4',
  r2Key: `${fileKeyPrefixForUser('user_1')}artifact/film.mp4`, sizeBytes: 4_000_000, mimeType: 'video/mp4' }

async function fixture(expiresAt = Date.now() + 60_000) {
  const convex = convexTest(schema, modules)
  const ids = await convex.run(async ctx => ({
    intentId: await ctx.db.insert('r2UploadIntents', {
      userId: input.userId, r2Key: input.r2Key, declaredSizeBytes: input.sizeBytes,
      mimeType: input.mimeType, status: 'pending', expiresAt, createdAt: Date.now(),
    }),
    subscriptionId: await ctx.db.insert('subscriptions', { userId: input.userId, overlayStorageBytesUsed: 0 }),
  }))
  return { convex, ...ids }
}

describe('atomic upload publication', () => {
  test('concurrent publication and lost acknowledgements return one file and charge storage once', async () => {
    const { convex, intentId, subscriptionId } = await fixture()
    const [first, duplicate] = await Promise.all([convex.mutation(commit, input), convex.mutation(commit, input)])
    expect(duplicate).toBe(first)
    await convex.run(ctx => ctx.db.patch(intentId, { expiresAt: 0 }))
    expect(await convex.mutation(commit, input)).toBe(first)
    await convex.run(async ctx => {
      expect(await ctx.db.query('files').collect()).toHaveLength(1)
      expect(await ctx.db.get(intentId)).toMatchObject({ status: 'finalized', fileId: first, actualSizeBytes: input.sizeBytes })
      expect(await ctx.db.get(subscriptionId)).toMatchObject({ overlayStorageBytesUsed: input.sizeBytes })
    })
    await expect(convex.mutation(commit, { ...input, name: 'different.mp4' })).rejects.toThrow('upload_publication_conflict')
    await convex.run(ctx => ctx.db.delete(first))
    await expect(convex.mutation(commit, input)).rejects.toThrow('upload_publication_conflict')
    expect(await convex.run(ctx => ctx.db.query('files').collect())).toHaveLength(0)
  })

  test('reconciles a prior registered file without charging storage twice', async () => {
    const { convex, subscriptionId } = await fixture()
    const prior = await convex.run(async ctx => {
      await ctx.db.patch(subscriptionId, { overlayStorageBytesUsed: input.sizeBytes })
      return await ctx.db.insert('files', {
        userId: input.userId, r2Key: input.r2Key, sizeBytes: input.sizeBytes, mimeType: input.mimeType,
        name: input.name, extension: 'mp4', type: 'file', kind: 'upload', createdAt: 1, updatedAt: 1,
      })
    })
    expect(await convex.mutation(commit, input)).toBe(prior)
    expect(await convex.run(ctx => ctx.db.get(subscriptionId))).toMatchObject({ overlayStorageBytesUsed: input.sizeBytes })
  })

  test('size, MIME, expiry and quota refusal leave no partial registration or consumed intent', async () => {
    const { convex, intentId, subscriptionId } = await fixture()
    for (const change of [{ sizeBytes: input.sizeBytes + 1 }, { sizeBytes: -1 }, { mimeType: 'text/plain' }]) {
      await expect(convex.mutation(commit, { ...input, ...change })).rejects.toThrow(/upload_(size_exceeds_intent|mime_mismatch)/)
    }
    await convex.run(ctx => ctx.db.patch(subscriptionId, { overlayStorageBytesUsed: FREE_PLAN_STORAGE_BYTES }))
    await expect(convex.mutation(commit, input)).rejects.toThrow('storage_limit_exceeded')
    await convex.run(ctx => ctx.db.patch(intentId, { expiresAt: 0 }))
    await expect(convex.mutation(commit, input)).rejects.toThrow('upload_intent_expired')
    expect(await convex.run(ctx => ctx.db.query('files').collect())).toHaveLength(0)
    expect(await convex.run(ctx => ctx.db.get(intentId))).toMatchObject({ status: 'pending' })
  })

  test('rejects foreign keys, workspaces and folders before registration, including on replay', async () => {
    const { convex } = await fixture()
    const folder = await convex.run(ctx => ctx.db.insert('files', {
      userId: 'other', name: 'Private', type: 'folder', kind: 'folder', createdAt: 1, updatedAt: 1,
    }))
    await expect(convex.mutation(commit, { ...input, userId: 'other' })).rejects.toThrow('Invalid file storage key')
    await expect(convex.mutation(commit, { ...input, workspaceId: 'foreign' })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
    await expect(convex.mutation(commit, { ...input, parentId: folder })).rejects.toThrow('Unauthorized')
    await expect(convex.mutation(commit, { ...input, serverSecret: 'wrong' })).rejects.toThrow('Unauthorized')
    await convex.mutation(commit, input)
    await expect(convex.mutation(commit, { ...input, workspaceId: 'foreign' })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  })

  test('keeps authorized folder placement and refuses replay after workspace membership is revoked', async () => {
    const { convex } = await fixture()
    const { membership, folder } = await convex.run(async ctx => {
      await ctx.db.insert('workspacePrincipals', {
        principalId: 'principal', workspaceId: 'workspace', type: 'human', userId: input.userId,
        displayName: 'Test', createdAt: 1, updatedAt: 1,
      })
      const membership = await ctx.db.insert('workspaceMemberships', {
        membershipId: 'member', workspaceId: 'workspace', principalId: 'principal',
        role: 'member', status: 'active', joinedAt: 1, updatedAt: 1,
      })
      const folder = await ctx.db.insert('files', {
        userId: input.userId, workspaceId: 'workspace', scope: 'personal', name: 'Films',
        type: 'folder', kind: 'folder', createdAt: 1, updatedAt: 1,
      })
      return { membership, folder }
    })
    const scoped = { ...input, parentId: folder, workspaceId: 'workspace' }
    const id = await convex.mutation(commit, scoped)
    expect(await convex.run(ctx => ctx.db.get(id))).toMatchObject({ parentId: folder, workspaceId: 'workspace' })
    await convex.run(ctx => ctx.db.delete(membership))
    await expect(convex.mutation(commit, scoped)).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  })
})
