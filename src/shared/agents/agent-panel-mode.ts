/**
 * Remembers the agent editor's panel presentation per workspace: docked side
 * panel or floating dialog. Persisted across sessions like other chrome
 * preferences; blocked storage simply falls back to docked.
 */

export type AgentPanelMode = 'docked' | 'floating'

const STORAGE_KEY = 'overlay:agent-panel-mode'

function readMap(): Record<string, AgentPanelMode> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, AgentPanelMode> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (value === 'docked' || value === 'floating') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

export function getAgentPanelMode(workspaceId: string | null | undefined): AgentPanelMode {
  return readMap()[workspaceId || 'legacy'] ?? 'docked'
}

export function setAgentPanelMode(
  workspaceId: string | null | undefined,
  mode: AgentPanelMode,
): void {
  if (typeof window === 'undefined') return
  try {
    const map = readMap()
    map[workspaceId || 'legacy'] = mode
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Private browsing / quota — lose the preference rather than crash chrome.
  }
}
