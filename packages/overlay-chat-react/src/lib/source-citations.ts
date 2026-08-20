/**
 * Mirror of `overlay-landing/src/lib/ask-knowledge-context.ts`'s public
 * `SourceCitationMap` type. Kept as a standalone module so the shared chat UI
 * package does not pull the full Convex-aware helper into the extension
 * bundle. Drift is tracked in `sync-manifest.json` via the sync script.
 */
export type SourceCitation = {
  kind: 'file' | 'memory'
  sourceId: string
  /** Human label for the source chip / panel row. */
  title?: string
  /** Short excerpt shown under the title in the sources panel. */
  snippet?: string
}

export type SourceCitationMap = Record<string, SourceCitation>
