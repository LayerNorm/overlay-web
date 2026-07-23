import assert from 'node:assert/strict'
import test from 'node:test'
import type { HybridSearchResult } from '@/shared/knowledge/hybrid-search'
import { KnowledgeSearchService } from '@/server/knowledge/KnowledgeSearchService'
import type { KnowledgeSearchRepository } from '@/server/knowledge/KnowledgeSearchRepository'
import { KnowledgeBaseRetrievalService } from './KnowledgeBaseRetrievalService'
import type { KnowledgeBaseService } from './KnowledgeBaseService'

test('KB retrieval derives scope from authorized enabled ready sources', async () => {
  let receivedIds: string[] | undefined
  const search: KnowledgeSearchRepository = {
    async hybridSearch(args): Promise<HybridSearchResult> {
      receivedIds = args.canonicalSourceIds
      return {
        chunks: [{
          chunkIndex: 0,
          knowledgeSourceId: 'source-ready',
          knowledgeSourceVersionId: 'version-ready',
          score: 1,
          sourceId: 'source-ready',
          sourceKind: 'file',
          text: 'Grounded source passage',
          title: 'Ready source',
        }],
      }
    },
  }
  const bases = {
    getKnowledgeBase: async () => ({ id: 'kb-1' }),
    listSources: async () => [
      { membership: { enabled: true }, source: { id: 'source-ready', status: 'ready', title: 'Ready source' } },
      { membership: { enabled: false }, source: { id: 'source-disabled', status: 'ready', title: 'Disabled' } },
      { membership: { enabled: true }, source: { id: 'source-indexing', status: 'indexing', title: 'Indexing' } },
    ],
  } as unknown as KnowledgeBaseService
  const service = new KnowledgeBaseRetrievalService({
    bases,
    search: new KnowledgeSearchService(search),
  })
  const result = await service.search({ knowledgeBaseId: 'kb-1', query: 'grounded', userId: 'user-1' })
  assert.deepEqual(receivedIds, ['source-ready'])
  assert.deepEqual(result.citations, [{
    sourceId: 'source-ready',
    sourceVersionId: 'version-ready',
    title: 'Ready source',
  }])
})

test('KB retrieval never falls back to unscoped user knowledge', async () => {
  let searched = false
  const service = new KnowledgeBaseRetrievalService({
    bases: {
      getKnowledgeBase: async () => ({ id: 'kb-empty' }),
      listSources: async () => [],
    } as unknown as KnowledgeBaseService,
    search: new KnowledgeSearchService({
      async hybridSearch() {
        searched = true
        return { chunks: [] }
      },
    }),
  })
  assert.deepEqual(
    await service.search({ knowledgeBaseId: 'kb-empty', query: 'anything', userId: 'user-1' }),
    { chunks: [], citations: [] },
  )
  assert.equal(searched, false)
})
