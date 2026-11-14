
import { api, convexWorkspaceId, queryConvex } from './convexClient'

// Native search is projected into the existing mobile result model.
export const WORKSPACE_SEARCH_KINDS = [
  'conversation',
  'file',
  'automation',
  'agent',
  'work',
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
 * Workspace search scoped to the active Convex workspace.
 */
export async function searchWorkspace(query: string): Promise<WorkspaceSearchResponse> {
  const trimmed = query.trim()
  if (trimmed.length < WORKSPACE_SEARCH_MIN_QUERY_LENGTH) return { query: trimmed, results: [], kinds: [] }
  const result = await queryConvex(api.search.browse.mentions, { workspaceId: convexWorkspaceId(), query: trimmed })
  const results: WorkspaceSearchResult[] = result ? [
    ...result.chats.map(row => ({ kind: 'conversation' as const, id: row.id, title: row.title })),
    ...result.files.map(row => ({ kind: 'file' as const, id: row.id, title: row.name })),
    ...result.automations.map(row => ({ kind: 'automation' as const, id: row.id, title: row.name || 'Automation', snippet: row.description })),
  ] : []
  return { query: trimmed, results, kinds: [...new Set(results.map(row => row.kind))] }
}
