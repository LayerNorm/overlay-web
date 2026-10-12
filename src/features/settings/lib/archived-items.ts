import type { ResourceScope } from '@/shared/workspaces/resource-scope'

/** The dropdown on Settings → Archived. `all` shows everything. */
export const ARCHIVED_CATEGORIES = ['all', 'chats', 'files', 'agents', 'extensions', 'automations'] as const
export type ArchivedCategoryFilter = (typeof ARCHIVED_CATEGORIES)[number]
export type ArchivedCategory = Exclude<ArchivedCategoryFilter, 'all'>

export const ARCHIVED_CATEGORY_LABELS: Record<ArchivedCategoryFilter, string> = {
  all: 'All',
  chats: 'Chats',
  files: 'Files & notes',
  agents: 'Agents',
  extensions: 'Extensions',
  automations: 'Automations',
}

/**
 * What an archived row is. An agent and one of its threads are different kinds on purpose: archiving a thread archives
 * only that thread, deleting an archived thread deletes only that thread, and neither ever touches the agent itself.
 */
export type ArchivedItemKind =
  | 'chat'
  | 'file'
  | 'folder'
  | 'note'
  | 'agent'
  | 'agent-thread'
  | 'skill'
  | 'mcp-server'
  | 'automation'

export interface ArchivedItem {
  /** Unique across kinds (an id alone is not: a thread and its agent are different rows). */
  key: string
  kind: ArchivedItemKind
  category: ArchivedCategory
  id: string
  name: string
  /** A second line: the agent a thread belongs to, a skill's description, and so on. */
  detail?: string
  /** Where it was archived from; null for things that are not scoped (chats, agent threads). */
  scope: ResourceScope | null
  archivedAt?: number
  /** Threads only: the agent they belong to, and whether that agent is itself archived. */
  agentId?: string
  agentArchived?: boolean
  /** Chats only: how to delete it. */
  conversationType?: string
  /** Chats and the like that can be opened to read before deciding. */
  href?: string
}

export function archivedItemKey(kind: ArchivedItemKind, id: string): string {
  return `${kind}:${id}`
}

export const ARCHIVED_KIND_LABELS: Record<ArchivedItemKind, string> = {
  chat: 'Chat',
  file: 'File',
  folder: 'Folder',
  note: 'Note',
  agent: 'Agent',
  'agent-thread': 'Agent thread',
  skill: 'Skill',
  'mcp-server': 'MCP server',
  automation: 'Automation',
}

/** The dropdown's filter and the search box, applied together. Newest archived first; rows without a date go last. */
export function filterArchivedItems(
  items: readonly ArchivedItem[],
  category: ArchivedCategoryFilter,
  query: string,
): ArchivedItem[] {
  const needle = query.trim().toLowerCase()
  return items
    .filter((item) => category === 'all' || item.category === category)
    .filter((item) => {
      if (!needle) return true
      return item.name.toLowerCase().includes(needle)
        || (item.detail?.toLowerCase().includes(needle) ?? false)
        || ARCHIVED_KIND_LABELS[item.kind].toLowerCase().includes(needle)
    })
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0) || a.name.localeCompare(b.name))
}

/**
 * The order to delete a selection in: an agent's threads before the agent, so that deleting the agent (which takes its
 * threads with it) never leaves a selected thread to fail with "not found".
 */
export function orderForDelete(items: readonly ArchivedItem[]): ArchivedItem[] {
  const rank = (item: ArchivedItem) => (item.kind === 'agent-thread' ? 0 : item.kind === 'agent' ? 2 : 1)
  return [...items].sort((a, b) => rank(a) - rank(b))
}

export interface BulkOutcome {
  succeeded: string[]
  failed: Array<{ key: string; message: string }>
}

export function summarizeBulk(verb: 'restored' | 'deleted', outcome: BulkOutcome): string {
  const ok = outcome.succeeded.length
  const bad = outcome.failed.length
  const noun = (count: number) => (count === 1 ? '1 item' : `${count} items`)
  if (bad === 0) return `${noun(ok)} ${verb}.`
  if (ok === 0) return `Could not change ${noun(bad)}. You may not have access to ${bad === 1 ? 'it' : 'them'}.`
  return `${noun(ok)} ${verb}. ${noun(bad)} could not be changed; you may not have access.`
}

/** Selected keys that still exist after the list changed. */
export function pruneSelection(selected: ReadonlySet<string>, items: readonly ArchivedItem[]): Set<string> {
  const live = new Set(items.map((item) => item.key))
  return new Set([...selected].filter((key) => live.has(key)))
}
