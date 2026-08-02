export type HybridSearchChunk = {
  chunkIndex: number
  score: number
  sourceId: string
  sourceKind: 'file' | 'memory'
  knowledgeSourceId?: string
  knowledgeSourceVersionId?: string
  /** Character offset of this chunk within the full extracted source text. */
  startOffset?: number
  text: string
  title?: string
}

export type HybridSearchResult = {
  chunks: HybridSearchChunk[]
}
