export type HybridSearchChunk = {
  chunkIndex: number
  score: number
  sourceId: string
  sourceKind: 'file' | 'memory'
  knowledgeSourceId?: string
  knowledgeSourceVersionId?: string
  text: string
  title?: string
}

export type HybridSearchResult = {
  chunks: HybridSearchChunk[]
}
