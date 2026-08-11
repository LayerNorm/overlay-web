import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { HybridSearchResult } from '@/shared/knowledge/hybrid-search'
import type { KnowledgeSearchArgs, KnowledgeSearchRepository } from './KnowledgeSearchRepository'
import { resolveBillingPayer } from '@/server/billing/billing-runtime'

export class ConvexKnowledgeSearchRepository implements KnowledgeSearchRepository {
  async hybridSearch(args: KnowledgeSearchArgs): Promise<HybridSearchResult> {
    const { accessToken: _accessToken, billing, ...search } = args
    const { actorUserId, ...providerBilling } = billing
    const payer = await resolveBillingPayer({
      programmaticSubjectId: billing.programmaticSubjectId,
      userId: actorUserId,
      workspaceId: args.workspaceId,
    })
    const result = await convex.action<HybridSearchResult>('knowledge/knowledge:hybridSearch', {
      ...search,
      ...providerBilling,
      billingUserId: actorUserId,
      ...(payer.scope === 'workspace'
        ? {
            billingAccountId: payer.billingAccountId,
            spendSubjectId: payer.subject.id,
            spendSubjectKind: payer.subject.kind,
          }
        : {}),
      serverSecret: getInternalApiSecret(),
    })
    if (!result) throw new Error('Convex knowledge search failed')
    return result
  }
}
