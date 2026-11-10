import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { HybridSearchResult } from '@/shared/knowledge/hybrid-search'
import type { KnowledgeSearchArgs, KnowledgeSearchRepository } from './KnowledgeSearchRepository'

export class ConvexKnowledgeSearchRepository implements KnowledgeSearchRepository {
  async hybridSearch(args: KnowledgeSearchArgs): Promise<HybridSearchResult> {
    const { accessToken: _accessToken, billing, ...search } = args
    const { actorUserId, ...providerBilling } = billing
    // Convex charges the searched workspace directly after embedding the query; nothing is held.
    const result = await convex.action<HybridSearchResult>('knowledge/knowledge:hybridSearch', {
      ...search,
      ...providerBilling,
      billingUserId: actorUserId,
      serverSecret: getInternalApiSecret(),
    })
    if (!result) throw new Error('Convex knowledge search failed')
    return result
  }
}
