import { afterEach, describe, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

// A workspace without a plan has no budget for embeddings: its memories and files are stored as text and found by
// word search, and nothing calls the embedding gateway.
describe('knowledge without budget for embeddings', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('a saved memory is stored without embeddings and found by word search', async () => {
    process.env.INTERNAL_API_SECRET = 'web-test-only'
    const gateway = vi.fn(async () => { throw new Error('the embedding gateway must not be called') })
    vi.stubGlobal('fetch', gateway)
    const t = convexTest(schema, modules)
    const workspaceId = 'ws-unpaid'
    const memoryId = await t.run(async (ctx) => {
      await ctx.db.insert('workspaces', { workspaceId, kind: 'personal', name: 'W', slug: workspaceId, status: 'active', createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspacePrincipals', { principalId: 'p-1', workspaceId, type: 'human', userId: 'user-1', displayName: 'Me', createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { membershipId: 'm-1', workspaceId, principalId: 'p-1', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 })
      return await ctx.db.insert('memories', {
        workspaceId, userId: 'user-1', content: 'The quarterly offsite is in Lisbon.', source: 'manual', createdAt: 1, updatedAt: 1,
      })
    })

    await t.action(internal.knowledge.knowledge.reindexMemoryInternal, { memoryId })
    const stored = await t.run(async (ctx) => ({
      chunks: await ctx.db.query('knowledgeChunks').collect(),
      embeddings: await ctx.db.query('knowledgeChunkEmbeddings').collect(),
    }))
    expect(stored.chunks.map((c) => c.sourceId)).toEqual([memoryId])
    expect(stored.embeddings).toEqual([])

    const result = await t.action(api.knowledge.knowledge.hybridSearch, {
      userId: 'user-1',
      billingUserId: 'user-1',
      serverSecret: 'web-test-only',
      idempotencyKey: 'search-1',
      operationId: 'memory.search',
      requestFingerprint: 'fp-1',
      query: 'Lisbon',
      sourceKind: 'memory',
      workspaceId,
    })
    expect(result.chunks.map((c) => c.sourceId)).toEqual([memoryId])
    expect(result.chunks[0]?.vecScore).toBeUndefined()
    expect(gateway).not.toHaveBeenCalled()
  })
})
