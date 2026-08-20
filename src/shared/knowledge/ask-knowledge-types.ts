/** Types for auto-retrieval / source citations (safe on client). */

/** 1-based citation index -> canonical file or memory (for UI links). */
export type SourceCitation = {
  kind: 'file' | 'memory'
  sourceId: string
  /** Human label for the source chip / panel row. */
  title?: string
  /** Short excerpt shown under the title in the sources panel. */
  snippet?: string
}

export type SourceCitationMap = Record<string, SourceCitation>

export type AutoRetrievalBundle = {
  extension: string
  citations: SourceCitationMap
}
