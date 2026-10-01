import 'server-only'

import type { HybridSearchResult } from '@/shared/knowledge/hybrid-search'

export type KnowledgeSearchArgs = {
  accessToken?: string
  /** Recency half-life on memory chunks; defaults on. */
  applyRecencyDecay?: boolean
  billing: {
    actorUserId: string
    idempotencyKey: string
    operationId: string
    programmaticSubjectId?: string
    requestFingerprint: string
  }
  canonicalSourceIds?: string[]
  /** Attach up-to-2 verbatim source-turn chunks to each memory hit. */
  includeProvenance?: boolean
  kLex?: number
  kVec?: number
  m?: number
  minVecScore?: number
  /** Anchor ms for temporal query parsing ("last week") — defaults to now. */
  asOfMs?: number
  query: string
  sourceKind?: 'file' | 'memory' | 'message'
  sourceKinds?: Array<'file' | 'memory' | 'message'>
  /** Parse a time window out of the query and fuse in-window chunks. */
  temporalQuery?: boolean
  userId: string
  workspaceId?: string
}

export interface KnowledgeSearchRepository {
  hybridSearch(args: KnowledgeSearchArgs): Promise<HybridSearchResult>
}

export class UnavailableKnowledgeSearchRepository implements KnowledgeSearchRepository {
  async hybridSearch(): Promise<HybridSearchResult> {
    throw new Error('Knowledge search is disabled for the selected runtime configuration')
  }
}
