import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  CanonicalKnowledgeIndexQueue,
  CanonicalKnowledgeIndexRequest,
} from './KnowledgeSourceIngestionService'

export class ConvexCanonicalKnowledgeIndexQueue implements CanonicalKnowledgeIndexQueue {
  async enqueue(request: CanonicalKnowledgeIndexRequest): Promise<string> {
    const result = await convex.mutation<{ jobId: string }>(
      'knowledge/bases:scheduleCanonicalSourceIndexByServer',
      { ...request, serverSecret: getInternalApiSecret() },
      { throwOnError: true },
    )
    if (!result?.jobId) throw new Error('Convex did not schedule canonical knowledge indexing')
    return result.jobId
  }

  async purge(request: { sourceId: string; userId: string }): Promise<void> {
    await convex.mutation(
      'knowledge/bases:purgeCanonicalSourceByServer',
      { ...request, serverSecret: getInternalApiSecret() },
      { throwOnError: true },
    )
  }
}
