import type { ThreadPanelKind } from '@/shared/agents/agent-right-sidebar-preferences'

/** A tab in an agent thread's right panel: a panel, a file preview, a web page, or a launcher ("New tab"). */
export type ThreadPanelTab =
  | { id: ThreadPanelKind; kind: ThreadPanelKind }
  | { id: string; kind: 'file'; fileId: string }
  | { id: string; kind: 'link'; url: string; title?: string }
  | { id: string; kind: 'new' }

export type ThreadPanelTabs = { tabs: ThreadPanelTab[]; active: string | null }

const fileTabId = (fileId: string) => `file:${fileId}`

export function tabsFromPanels(panels: readonly ThreadPanelKind[], active: ThreadPanelKind | null): ThreadPanelTabs {
  return { tabs: panels.map((kind) => ({ id: kind, kind })), active: active ?? panels[0] ?? null }
}

/** The panels worth remembering: file previews and web pages belong to one thread and launchers are transient. */
export function panelsOf(state: ThreadPanelTabs): { tabs: ThreadPanelKind[]; active: ThreadPanelKind | null } {
  const tabs = state.tabs.flatMap((tab) => (tab.kind === 'file' || tab.kind === 'new' || tab.kind === 'link' ? [] : [tab.kind]))
  const active = tabs.find((kind) => kind === state.active) ?? null
  return { tabs, active }
}

/** A panel or file that is already open is focused instead of opened twice. */
export function openPanel(state: ThreadPanelTabs, kind: ThreadPanelKind): ThreadPanelTabs {
  if (state.tabs.some((tab) => tab.id === kind)) return { ...state, active: kind }
  return { tabs: [...state.tabs, { id: kind, kind }], active: kind }
}

export function openFile(state: ThreadPanelTabs, fileId: string): ThreadPanelTabs {
  const id = fileTabId(fileId)
  if (state.tabs.some((tab) => tab.id === id)) return { ...state, active: id }
  return { tabs: [...state.tabs, { id, kind: 'file', fileId }], active: id }
}

/** A link opened from the thread is a tab of its own; the same page opened again is focused. */
export function openLink(state: ThreadPanelTabs, url: string, title?: string): ThreadPanelTabs {
  const id = `link:${url}`
  if (state.tabs.some((tab) => tab.id === id)) return { ...state, active: id }
  return { tabs: [...state.tabs, { id, kind: 'link', url, title }], active: id }
}

export function openLauncher(state: ThreadPanelTabs, id: string): ThreadPanelTabs {
  return { tabs: [...state.tabs, { id, kind: 'new' }], active: id }
}

/** A launcher turns into the panel picked from it, like a browser's new tab navigating in place. */
export function replaceLauncher(state: ThreadPanelTabs, launcherId: string, kind: ThreadPanelKind): ThreadPanelTabs {
  if (state.tabs.some((tab) => tab.id === kind)) {
    return { tabs: state.tabs.filter((tab) => tab.id !== launcherId), active: kind }
  }
  return { tabs: state.tabs.map((tab) => (tab.id === launcherId ? { id: kind, kind } : tab)), active: kind }
}

/** Closing a tab selects its left neighbour; closing the last one returns the panel to the agent's home. */
export function closeTab(state: ThreadPanelTabs, id: string): ThreadPanelTabs {
  const index = state.tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return state
  const tabs = state.tabs.filter((tab) => tab.id !== id)
  if (tabs.length === 0) return { tabs, active: null }
  return { tabs, active: state.active === id ? tabs[Math.max(0, index - 1)]!.id : state.active }
}

export function selectTab(state: ThreadPanelTabs, id: string): ThreadPanelTabs {
  return state.tabs.some((tab) => tab.id === id) ? { ...state, active: id } : state
}

/** File previews and web pages are per thread, so switching threads closes them. */
export function withoutFileTabs(state: ThreadPanelTabs): ThreadPanelTabs {
  const perThread = (tab: ThreadPanelTab) => tab.kind === 'file' || tab.kind === 'link'
  if (!state.tabs.some(perThread)) return state
  return state.tabs
    .filter(perThread)
    .reduce((next, tab) => closeTab(next, tab.id), state)
}

export function activeTab(state: ThreadPanelTabs): ThreadPanelTab | null {
  return state.tabs.find((tab) => tab.id === state.active) ?? state.tabs[0] ?? null
}
