import type { WorkspaceShareAccessRole } from '@overlay/workspace-contracts'

/**
 * Shape of workspace-wide search. Kept isomorphic so the palette, desktop, and
 * mobile adapters render identical results from the same contract.
 */
export const WORKSPACE_SEARCH_KINDS = [
  'conversation',
  'file',
  'project',
  'knowledge_base',
  'automation',
  'agent',
] as const
export type WorkspaceSearchKind = (typeof WORKSPACE_SEARCH_KINDS)[number]

export type WorkspaceSearchResult = {
  kind: WorkspaceSearchKind
  id: string
  title: string
  /** Match context. Never populated for a resource the actor cannot open. */
  snippet?: string
  subtitle?: string
  /** Present when access arrives through sharing rather than ownership. */
  sharedVia?: 'direct' | 'team' | 'room'
  accessRole?: WorkspaceShareAccessRole
  updatedAt?: number
}

export type WorkspaceSearchResponse = {
  query: string
  results: WorkspaceSearchResult[]
  /** Kinds that were searched, so a client can label partial coverage. */
  kinds: WorkspaceSearchKind[]
}

export const WORKSPACE_SEARCH_MIN_QUERY_LENGTH = 2
export const WORKSPACE_SEARCH_DEFAULT_LIMIT = 8

export function isWorkspaceSearchKind(value: unknown): value is WorkspaceSearchKind {
  return typeof value === 'string'
    && (WORKSPACE_SEARCH_KINDS as readonly string[]).includes(value)
}

export function parseWorkspaceSearchKinds(value: unknown): WorkspaceSearchKind[] {
  const raw = typeof value === 'string'
    ? value.split(',')
    : Array.isArray(value) ? value : []
  const kinds = raw.map((entry) => String(entry).trim()).filter(isWorkspaceSearchKind)
  return kinds.length > 0 ? [...new Set(kinds)] : [...WORKSPACE_SEARCH_KINDS]
}

/** Case- and diacritic-insensitive contains match used by every kind. */
export function matchesSearchQuery(haystack: string | undefined, query: string): boolean {
  if (!haystack) return false
  return normalizeSearchText(haystack).includes(normalizeSearchText(query))
}

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase()
}

/**
 * Ranks exact and prefix matches above mid-string matches, then by recency, so
 * one relevance rule applies to every resource kind.
 */
export function rankSearchResults(
  results: readonly WorkspaceSearchResult[],
  query: string,
): WorkspaceSearchResult[] {
  const needle = normalizeSearchText(query)
  return [...results].sort((a, b) => (
    score(b, needle) - score(a, needle)
    || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    || a.title.localeCompare(b.title)
  ))
}

function score(result: WorkspaceSearchResult, needle: string): number {
  const title = normalizeSearchText(result.title)
  if (!needle) return 0
  if (title === needle) return 3
  if (title.startsWith(needle)) return 2
  if (title.includes(needle)) return 1
  return 0
}

export const WORKSPACE_SEARCH_KIND_LABELS: Record<WorkspaceSearchKind, string> = {
  conversation: 'Chats',
  file: 'Files',
  project: 'Projects',
  knowledge_base: 'Knowledge',
  automation: 'Automations',
  agent: 'Agents',
}

export function workspaceSearchHref(result: WorkspaceSearchResult, workspaceId?: string | null): string {
  const base = workspaceId ? `/app/w/${encodeURIComponent(workspaceId)}` : '/app'
  switch (result.kind) {
    case 'conversation':
      return `${base}/chat?id=${encodeURIComponent(result.id)}`
    case 'file':
      return `${base}/files?file=${encodeURIComponent(result.id)}`
    case 'project':
      return `${base}/projects?projectId=${encodeURIComponent(result.id)}`
    case 'knowledge_base':
      return `${base}/knowledge/${encodeURIComponent(result.id)}`
    case 'automation':
      return `${base}/automations?automationId=${encodeURIComponent(result.id)}`
    case 'agent':
      return `${base}/agents?agentId=${encodeURIComponent(result.id)}`
  }
}
