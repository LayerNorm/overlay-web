const STORAGE_KEY = 'overlay:agent-right-sidebar'

export type AgentRightSidebarTab = 'details' | 'library'

export type AgentRightSidebarPreferences = {
  open: boolean
  tab: AgentRightSidebarTab
}

const TABS: readonly AgentRightSidebarTab[] = ['details', 'library']

export function getAgentRightSidebarPreferences(): AgentRightSidebarPreferences {
  if (typeof window === 'undefined') return { open: false, tab: 'details' }
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    if (!value) return { open: false, tab: 'details' }
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return { open: false, tab: 'details' }
    const preferences = parsed as { open?: unknown; tab?: unknown }
    return {
      open: preferences.open === true,
      tab: TABS.includes(preferences.tab as AgentRightSidebarTab) ? preferences.tab as AgentRightSidebarTab : 'details',
    }
  } catch {
    return { open: false, tab: 'details' }
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
