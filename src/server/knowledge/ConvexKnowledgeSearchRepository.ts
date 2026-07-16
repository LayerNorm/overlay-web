import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { HybridSearchResult } from '@/shared/knowledge/hybrid-search'
import type { KnowledgeSearchArgs, KnowledgeSearchRepository } from './KnowledgeSearchRepository'

export class ConvexKnowledgeSearchRepository implements KnowledgeSearchRepository {
  async hybridSearch(args: KnowledgeSearchArgs): Promise<HybridSearchResult> {
    const result = await convex.action<HybridSearchResult>('knowledge/knowledge:hybridSearch', {
      ...args,
      serverSecret: getInternalApiSecret(),
    })
    if (!result) throw new Error('Convex knowledge search failed')
    return result
  }
}
