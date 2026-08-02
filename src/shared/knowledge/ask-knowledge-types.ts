/** Types for auto-retrieval / source citations (safe on client). */

/** 1-based citation index -> canonical file or memory (for UI links). */
export type SourceCitationMap = Record<string, { kind: 'file' | 'memory'; sourceId: string }>

export type AutoRetrievalBundle = {
  extension: string
  citations: SourceCitationMap
}
