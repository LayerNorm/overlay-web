export type HybridSearchChunk = {
  chunkIndex: number
  score: number
  /** Raw vector similarity when the chunk ranked via vector search — absent for lexical-only hits. `score` is the fused RRF value. */
  vecScore?: number
  sourceId: string
  sourceKind: 'file' | 'memory'
  text: string
  title?: string
  knowledgeSourceId?: string
  startOffset?: number
  knowledgeSourceVersionId?: string
}

export type HybridSearchResult = {
  chunks: HybridSearchChunk[]
}
