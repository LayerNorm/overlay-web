import 'server-only'

import { logger } from '@/server/observability/logger'
import type { AutoRetrievalBundle } from '@/shared/knowledge/ask-knowledge-types'
import { formatAutoRetrievalBundle } from '@/shared/knowledge/auto-retrieval-format'
import { getOverlayServerContext } from '@/server/bootstrap'

export { formatAutoRetrievalBundle }

/** Retrieval-only context for the model. Durable facts the user wants remembered are written via save_memory (Ask or Act), not here. */

const MIN_USER_CHARS = 8
const MAX_QUERY_CHARS = 500

/**
 * Hybrid search for the latest user message: system extension + citation map for source metadata.
 */
export async function buildAutoRetrievalBundle(args: {
  billing: {
    actorUserId: string
    idempotencyKey: string
    operationId: string
    programmaticSubjectId?: string
    requestFingerprint: string
  }
  userMessage: string
  userId: string
  accessToken?: string
  includeMemories?: boolean
  workspaceId?: string
}): Promise<AutoRetrievalBundle> {
  const q = args.userMessage.trim()
  if (q.length < MIN_USER_CHARS) {
    return { extension: '', citations: {} }
  }

  try {
    const result = await getOverlayServerContext().knowledgeSearchService.hybridSearch({
      billing: args.billing,
      userId: args.userId,
      query: q.slice(0, MAX_QUERY_CHARS),
      workspaceId: args.workspaceId,
      ...(args.accessToken ? { accessToken: args.accessToken } : {}),
      ...(args.includeMemories === false ? { sourceKind: 'file' as const } : {}),
      m: 10,
      kVec: 40,
      kLex: 40,
      // Date-aware retrieval + verbatim backing for distilled memory facts.
      temporalQuery: true,
      asOfMs: Date.now(),
      includeProvenance: true,
    })
    return formatAutoRetrievalBundle(result.chunks, args.includeMemories)
  } catch (e) {
    logger.warn('[ask-knowledge-context] hybridSearch failed:', e)
    return { extension: '', citations: {} }
  }
}



/**
 * @deprecated Prefer {@link buildAutoRetrievalBundle} when you need citation metadata.
 */
export async function buildAutoRetrievalSystemExtension(args: {
  billing: {
    actorUserId: string
    idempotencyKey: string
    operationId: string
    programmaticSubjectId?: string
    requestFingerprint: string
  }
  userMessage: string
  userId: string
  accessToken?: string
  workspaceId?: string
}): Promise<string> {
  const { extension } = await buildAutoRetrievalBundle(args)
  return extension
}
