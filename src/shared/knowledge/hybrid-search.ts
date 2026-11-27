export type HybridSearchChunk = {
  chunkIndex: number
  score: number
  /** Raw vector similarity when the chunk ranked via vector search — absent for lexical-only hits. `score` is the fused RRF value. */
  vecScore?: number
  /** Personal (only its owner sees it) or Workspace (every member does). */
  scope?: 'personal' | 'workspace'
  sourceId: string
  sourceKind: 'file' | 'memory' | 'message'
  text: string
  title?: string
  knowledgeSourceId?: string
  startOffset?: number
  knowledgeSourceVersionId?: string
}

export type HybridSearchResult = {
  chunks: HybridSearchChunk[]
}
