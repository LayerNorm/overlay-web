import 'server-only'

import type { HybridSearchChunk } from '@/shared/knowledge/hybrid-search'
import { KnowledgeSearchService } from '@/server/knowledge/KnowledgeSearchService'
import { KnowledgeBaseService } from './KnowledgeBaseService'

export type KnowledgeBaseCitation = {
  sourceId: string
  sourceVersionId?: string
  title: string
}

export type KnowledgeBaseSearchResult = {
  chunks: HybridSearchChunk[]
  citations: KnowledgeBaseCitation[]
}

export class KnowledgeBaseRetrievalService {
  constructor(private readonly deps: {
    bases: KnowledgeBaseService
    search: KnowledgeSearchService
  }) {}

  async search(args: {
    accessToken?: string
    knowledgeBaseId: string
    limit?: number
    query: string
    userId: string
  }): Promise<KnowledgeBaseSearchResult> {
    await this.deps.bases.getKnowledgeBase(args)
    const sourceDetails = (await this.deps.bases.listSources(args))
      .filter(({ membership, source }) => membership.enabled && source.status === 'ready')
    if (sourceDetails.length === 0) return { chunks: [], citations: [] }
    const sourceById = new Map(sourceDetails.map(({ source }) => [source.id, source]))
    const result = await this.deps.search.hybridSearch({
      accessToken: args.accessToken,
      canonicalSourceIds: [...sourceById.keys()],
      m: args.limit ?? 12,
      query: args.query,
      userId: args.userId,
    })
    const citations = new Map<string, KnowledgeBaseCitation>()
    for (const chunk of result.chunks) {
      const canonicalId = chunk.knowledgeSourceId
      const source = canonicalId ? sourceById.get(canonicalId) : undefined
      if (!canonicalId || !source || citations.has(canonicalId)) continue
      citations.set(canonicalId, {
        sourceId: canonicalId,
        sourceVersionId: chunk.knowledgeSourceVersionId,
        title: source.title,
      })
    }
    return { chunks: result.chunks, citations: [...citations.values()] }
  }
}
