const STORAGE_KEY = 'overlay:agent-right-sidebar'

/** What an agent thread's right panel can show; each opens as one tab. */
export type ThreadPanelKind = 'assignments' | 'progress' | 'computer' | 'changes' | 'files' | 'terminal' | 'agent'

export const THREAD_PANEL_KINDS: readonly ThreadPanelKind[] = ['assignments', 'progress', 'computer', 'changes', 'files', 'terminal', 'agent']

export const THREAD_PANEL_DEFAULT_WIDTH = 480
export const THREAD_PANEL_MIN_WIDTH = 360

export type AgentRightSidebarPreferences = {
  open: boolean
  /** The panels left open, in tab order. File previews and new-tab launchers are not remembered. */
  tabs: ThreadPanelKind[]
  /** The selected panel, or null when the selected tab was not a remembered panel. */
  active: ThreadPanelKind | null
  /** The width the person dragged the panel to. */
  width: number
  /** Whether the panel is widened over most of the thread. */
  expanded: boolean
}

export const DEFAULT_AGENT_RIGHT_SIDEBAR_PREFERENCES: AgentRightSidebarPreferences = {
  open: false,
  tabs: [],
  active: null,
  width: THREAD_PANEL_DEFAULT_WIDTH,
  expanded: false,
}

/** Tabs named before the panel became tabbed (Details, Library) map to their new panels. */
const LEGACY_TABS: Record<string, ThreadPanelKind> = { details: 'agent', library: 'files', computer: 'computer' }

function panelKind(value: unknown): ThreadPanelKind | null {
  if (typeof value !== 'string') return null
  if ((THREAD_PANEL_KINDS as readonly string[]).includes(value)) return value as ThreadPanelKind
  return LEGACY_TABS[value] ?? null
}

/** Reads a stored value, keeping only what is valid and falling back to the defaults for the rest. */
export function parseAgentRightSidebarPreferences(value: unknown): AgentRightSidebarPreferences {
  const fallback = DEFAULT_AGENT_RIGHT_SIDEBAR_PREFERENCES
  if (!value || typeof value !== 'object') return fallback
  const stored = value as { open?: unknown; tabs?: unknown; active?: unknown; tab?: unknown; width?: unknown; expanded?: unknown }
  const listed = Array.isArray(stored.tabs)
    ? [...new Set(stored.tabs.map(panelKind).filter((kind): kind is ThreadPanelKind => kind !== null))]
    : null
  const legacyTab = panelKind(stored.tab)
  const tabs = listed ?? (legacyTab && !fallback.tabs.includes(legacyTab) ? [...fallback.tabs, legacyTab] : fallback.tabs)
  const active = panelKind(stored.active ?? stored.tab)
  return {
    open: stored.open === true,
    tabs,
    active: active && tabs.includes(active) ? active : tabs[0] ?? null,
    width: typeof stored.width === 'number' && Number.isFinite(stored.width)
      ? Math.max(THREAD_PANEL_MIN_WIDTH, Math.round(stored.width))
      : fallback.width,
    expanded: stored.expanded === true,
  }
}

export function getAgentRightSidebarPreferences(): AgentRightSidebarPreferences {
  if (typeof window === 'undefined') return DEFAULT_AGENT_RIGHT_SIDEBAR_PREFERENCES
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return parseAgentRightSidebarPreferences(value ? JSON.parse(value) : null)
  } catch {
    return DEFAULT_AGENT_RIGHT_SIDEBAR_PREFERENCES
  }
}

export function setAgentRightSidebarPreferences(preferences: AgentRightSidebarPreferences): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Blocked storage should not affect sidebar controls.
  }
}
