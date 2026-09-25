import { formatAutoRetrievalBundle } from '../../../src/shared/knowledge/auto-retrieval-format'
import type { HybridSearchChunk } from '../../../src/shared/knowledge/hybrid-search'
import { hybridSearch } from './convex-client'
import { config } from './config'

/**
 * Retrieval exactly as a chat turn sees it: real hybridSearch over memory +
 * raw message chunks, formatted with the same AUTO_RETRIEVED_KNOWLEDGE block
 * builder the Act prompt uses. `includeMessages` toggles the M2 evidence layer
 * for pre/post comparison.
 */
export async function retrieveMemoryContext(args: {
  userId: string
  query: string
}): Promise<{ extension: string; chunks: HybridSearchChunk[] }> {
  const chunks = await hybridSearch({
    userId: args.userId,
    query: args.query,
    // M2 deployments take `sourceKinds`; a pre-M2 deployment rejects the
    // unknown arg, so the flag-off path uses the original singular arg.
    ...(config.includeMessages
      ? { sourceKinds: ['memory', 'message'] as Array<'file' | 'memory' | 'message'> }
      : { sourceKind: 'memory' as const }),
    kVec: config.retrieval.kVec,
    kLex: config.retrieval.kLex,
    m: config.retrieval.m,
  })
  const bundle = formatAutoRetrievalBundle(chunks)
  return { extension: bundle.extension, chunks }
}
