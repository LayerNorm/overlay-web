import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from '../schema'
import { embedViaGateway } from './knowledge'

const modules = import.meta.glob('../../convex/**/*.ts')
const knowledgeModule = modules['./knowledge.ts']
if (knowledgeModule) modules['../knowledge/knowledge.ts'] = knowledgeModule
const replace = makeFunctionReference<'mutation'>('knowledge/knowledge:replaceKnowledgeSource')
const validate = makeFunctionReference<'query'>('knowledge/knowledge:validateCurrentFileChunks')
const search = makeFunctionReference<'action'>('knowledge/knowledge:hybridSearch')
const serverSecret = 'knowledge-test-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = serverSecret })

async function fileFixture() {
  const convex = convexTest(schema, modules)
  const fileId = await convex.run(ctx => ctx.db.insert('files', {
    userId: 'alice', name: 'source.txt', type: 'file', kind: 'upload',
    content: 'current text', textContent: 'current text', sourceChecksumSha256: 'current',
    createdAt: 1, updatedAt: 1,
  }))
  return { convex, fileId }
}

describe('file chunk revision safeguards', () => {
  it('keeps lexical chunks without embeddings and preserves existing vectors on an identical lexical save', async () => {
    const { convex, fileId } = await fileFixture()
    const input = {
      userId: 'alice', sourceKind: 'file' as const, sourceId: fileId, sourceRevision: 'current',
      segments: [{ text: 'current text', chunkIndex: 0, startOffset: 0 }],
    }
    await convex.mutation(replace, input)
    const chunk = await convex.run(ctx => ctx.db.query('knowledgeChunks').collect())
    expect(chunk).toHaveLength(1)
    await convex.run(ctx => ctx.db.insert('knowledgeChunkEmbeddings', {
      chunkId: chunk[0]!._id, userId: 'alice', sourceKind: 'file', embedding: [0.1],
    }))
    await convex.mutation(replace, input)
    await convex.run(async ctx => {
      expect(await ctx.db.query('knowledgeChunks').collect()).toHaveLength(1)
      expect(await ctx.db.query('knowledgeChunkEmbeddings').collect()).toHaveLength(1)
    })
  })

  it('refuses stale revision writes and filters deleted, private, stale, and mismatched legacy chunks', async () => {
    const { convex, fileId } = await fileFixture()
    const privateFileId = await convex.run(ctx => ctx.db.insert('files', {
      userId: 'alice', workspaceId: 'private-workspace', name: 'private.txt', type: 'file', kind: 'upload',
      content: 'private source text', sourceChecksumSha256: 'private',
      createdAt: 1, updatedAt: 1,
    }))
    const privateChunkId = await convex.run(ctx => ctx.db.insert('knowledgeChunks', {
      userId: 'alice', workspaceId: 'private-workspace', sourceKind: 'file', sourceId: privateFileId,
      chunkIndex: 0, startOffset: 0, text: 'private source text', createdAt: 1, updatedAt: 1,
    }))
    await convex.mutation(replace, {
      userId: 'alice', sourceKind: 'file', sourceId: fileId, sourceRevision: 'current',
      segments: [{ text: 'current text', chunkIndex: 0, startOffset: 0 }],
    })
    await convex.mutation(replace, {
      userId: 'alice', sourceKind: 'file', sourceId: fileId, sourceRevision: 'stale',
      segments: [{ text: 'stale text', chunkIndex: 0, startOffset: 0 }],
    })
    const legacyId = await convex.run(ctx => ctx.db.insert('knowledgeChunks', {
      userId: 'alice', sourceKind: 'file', sourceId: fileId, chunkIndex: 1, startOffset: 0,
      text: 'current text', createdAt: 1, updatedAt: 1,
    }))
    const mismatchedId = await convex.run(ctx => ctx.db.insert('knowledgeChunks', {
      userId: 'alice', sourceKind: 'file', sourceId: fileId, chunkIndex: 2, startOffset: 0,
      text: 'not the source text', createdAt: 1, updatedAt: 1,
    }))
    const current = await convex.run(async ctx =>
      (await ctx.db.query('knowledgeChunks').collect()).filter(chunk => chunk.sourceRevision === 'current'))
    expect(current.map(chunk => chunk.text)).toEqual(['current text'])
    const valid = await convex.query(validate, {
      userId: 'alice',
      chunks: [
        ...current.map(chunk => ({ chunkId: chunk._id, sourceRevision: 'current' })),
        { chunkId: legacyId }, { chunkId: mismatchedId }, { chunkId: privateChunkId },
      ],
    })
    expect(valid).toContain(current[0]!._id)
    expect(valid).toContain(legacyId)
    expect(valid).not.toContain(mismatchedId)
    expect(valid).not.toContain(privateChunkId)
    await convex.run(ctx => ctx.db.patch(fileId, { deletedAt: Date.now() }))
    expect(await convex.query(validate, { userId: 'alice', chunks: [{ chunkId: legacyId }] })).toEqual([])
  })

  it('returns lexical file hits with truthful pricing fallback metadata', async () => {
    const { convex, fileId } = await fileFixture()
    await convex.mutation(replace, {
      userId: 'alice', sourceKind: 'file', sourceId: fileId, sourceRevision: 'current',
      segments: [
        { text: 'left context', chunkIndex: 0, startOffset: 0 },
        { text: 'primary evidence', chunkIndex: 1, startOffset: 13 },
        { text: 'right context', chunkIndex: 2, startOffset: 29 },
      ],
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))
    try {
      const result = await convex.action(search, {
        userId: 'alice', billingUserId: 'alice', serverSecret,
        idempotencyKey: 'search-id', operationId: 'search-op', requestFingerprint: 'search-fingerprint',
        query: 'primary evidence', resilientFiles: true, sourceKind: 'file', kLex: 1, m: 3,
      })
      expect(result.mode).toBe('lexical')
      expect(result.degradationReason).toBe('pricing_unavailable')
      expect(result.chunks.map(chunk => chunk.text)).toEqual([
        'primary evidence', 'left context', 'right context',
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('embedViaGateway', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('applies a 30-second timeout to a stalled embedding request', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-key')

    const controller = new AbortController()
    const timeoutError = Object.assign(new Error('embedding request timed out'), {
      name: 'TimeoutError',
    })
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal)

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort(timeoutError)
      throw controller.signal.reason
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(embedViaGateway(['text to embed'])).rejects.toMatchObject({
      name: 'TimeoutError',
    })

    expect(timeoutSpy).toHaveBeenCalledOnce()
    expect(timeoutSpy).toHaveBeenCalledWith(30_000)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})