/**
 * Mirror of `overlay-landing/src/lib/ask-knowledge-context.ts`'s public
 * `SourceCitationMap` type. Kept as a standalone module so the shared chat UI
 * package does not pull the full Convex-aware helper into the extension
 * bundle. Drift is tracked in `sync-manifest.json` via the sync script.
 */
export type SourceCitationMap = Record<
  string,
  { kind: 'file' | 'memory'; sourceId: string }
>
