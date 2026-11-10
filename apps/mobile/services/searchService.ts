
// Mirrors src/shared/search/workspace-search — kept local because mobile only
// imports published @overlay/* packages, not web src.
export const WORKSPACE_SEARCH_KINDS = [
  'conversation',
  'file',
  'automation',
  'agent',
] as const
export type WorkspaceSearchKind = (typeof WORKSPACE_SEARCH_KINDS)[number]

export type WorkspaceSearchResult = {
  kind: WorkspaceSearchKind
  id: string
  title: string
  snippet?: string
  subtitle?: string
  sharedVia?: 'direct' | 'team' | 'room'
  accessRole?: string
  updatedAt?: number
}

export type WorkspaceSearchResponse = {
  query: string
  results: WorkspaceSearchResult[]
  kinds: WorkspaceSearchKind[]
}

export const WORKSPACE_SEARCH_MIN_QUERY_LENGTH = 2

/**
 * Workspace-wide search scoped to the active workspace (the workspace header
 * is attached automatically by appRequest).
 */
export async function searchWorkspace(query: string): Promise<WorkspaceSearchResponse> {
  // Convex-native in Phase 1
  throw new Error('Workspace search will be available after the Phase 1 data migration.')
}
