export const KNOWLEDGE_CHUNK_CHARS = 1800
export const KNOWLEDGE_CHUNK_OVERLAP = 80

export type KnowledgeTextChunk = {
  chunkIndex: number
  startOffset: number
  text: string
}

export function chunkKnowledgeText(full: string): KnowledgeTextChunk[] {
  const trimmed = full.trim()
  if (!trimmed) return []
  const chunks: KnowledgeTextChunk[] = []
  let start = 0
  let chunkIndex = 0
  while (start < trimmed.length) {
    const end = Math.min(start + KNOWLEDGE_CHUNK_CHARS, trimmed.length)
    chunks.push({ chunkIndex: chunkIndex++, startOffset: start, text: trimmed.slice(start, end) })
    if (end === trimmed.length) break
    start = Math.max(0, end - KNOWLEDGE_CHUNK_OVERLAP)
  }
  return chunks
}
