/**
 * Remembers when each agent was last opened per workspace so the Agents
 * roster can default-select the most recently used agent and order the
 * list by recency instead of alphabetically.
 *
 * This is a usage heuristic, not server-side run history: opening an agent
 * is the closest client-side signal to "I am working with this agent".
 * It persists in localStorage (guarded for private browsing) so recency
 * survives restarts, unlike the session-scoped chat-restore preference.
 */

const STORAGE_KEY = 'overlay:last-agent-by-workspace'

const MAX_ENTRIES = 200

function workspaceKey(workspaceId: string | null | undefined): string {
  return workspaceId || 'legacy'
}

type AgentRecencyMap = Record<string, Record<string, number>>

function readMap(): AgentRecencyMap {
  if (typeof window === 'undefined') return {}
  try {
    const storage = window.localStorage
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: AgentRecencyMap = {}
    for (const [workspace, entries] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue
      const cleaned: Record<string, number> = {}
      for (const [agentId, openedAt] of Object.entries(entries as Record<string, unknown>)) {
        if (agentId && typeof openedAt === 'number' && Number.isFinite(openedAt)) cleaned[agentId] = openedAt
      }
      if (Object.keys(cleaned).length > 0) out[workspace] = cleaned
    }
    return out
  } catch {
    return {}
  }
}

function writeMap(map: AgentRecencyMap): void {
  if (typeof window === 'undefined') return
  try {
    const entries = Object.entries(map)
    const pruned: AgentRecencyMap =
      entries.length <= MAX_ENTRIES
        ? map
        : Object.fromEntries(entries.slice(entries.length - MAX_ENTRIES))
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned))
  } catch {
    // Private browsing / quota — lose the preference rather than crash chrome.
  }
}

export function rememberAgentOpened(
  workspaceId: string | null | undefined,
  agentId: string,
  now: number = Date.now(),
): void {
  if (!agentId || !Number.isFinite(now)) return
  const map = readMap()
  const key = workspaceKey(workspaceId)
  map[key] = { ...(map[key] ?? {}), [agentId]: now }
  writeMap(map)
}

/** Milliseconds epoch when each agent id was last opened in this workspace. */
export function getAgentOpenedAt(workspaceId: string | null | undefined): Record<string, number> {
  return readMap()[workspaceKey(workspaceId)] ?? {}
}

/** Most recently opened agent id in this workspace, or null when unknown. */
export function getLastOpenedAgentId(workspaceId: string | null | undefined): string | null {
  const entries = Object.entries(getAgentOpenedAt(workspaceId))
  if (entries.length === 0) return null
  entries.sort((a, b) => b[1] - a[1])
  return entries[0]?.[0] ?? null
}

export function clearAgentOpened(
  workspaceId: string | null | undefined,
  agentId?: string,
): void {
  const map = readMap()
  const key = workspaceKey(workspaceId)
  if (agentId) {
    if (!map[key]?.[agentId]) return
    const rest = { ...(map[key] as Record<string, number>) }
    delete rest[agentId]
    if (Object.keys(rest).length === 0) delete map[key]
    else map[key] = rest
  } else {
    delete map[key]
  }
  writeMap(map)
}

/**
 * Orders agents by recency of use (most recent first). Agents with no
 * recorded use fall back to alphabetical order after the used ones.
 */
export function sortAgentsByRecency<T extends { id: string; name: string }>(
  agents: readonly T[],
  openedAt: Record<string, number>,
): T[] {
  return [...agents].sort((a, b) => {
    const aAt = openedAt[a.id] ?? Number.NEGATIVE_INFINITY
    const bAt = openedAt[b.id] ?? Number.NEGATIVE_INFINITY
    if (aAt !== bAt) return bAt - aAt
    return a.name.localeCompare(b.name)
  })
}
