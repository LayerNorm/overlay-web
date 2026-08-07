export type HybridSearchChunk = {
  chunkIndex: number
  score: number
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
