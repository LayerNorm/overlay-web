import 'server-only'

import type { HybridSearchResult } from '@/shared/knowledge/hybrid-search'

export type KnowledgeSearchArgs = {
  accessToken?: string
  billing: {
    idempotencyKey: string
    operationId: string
    requestFingerprint: string
  }
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
