import 'server-only'

import type { HybridSearchResult } from '@/shared/knowledge/hybrid-search'

export type KnowledgeSearchArgs = {
  accessToken?: string
  billing: {
    actorUserId: string
    idempotencyKey: string
    operationId: string
    programmaticSubjectId?: string
    requestFingerprint: string
  }
  canonicalSourceIds?: string[]
  kLex?: number
  kVec?: number
  m?: number
  minVecScore?: number
  projectId?: string
  query: string
  sourceKind?: 'file' | 'memory'
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
