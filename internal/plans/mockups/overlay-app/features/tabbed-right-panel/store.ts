import { useSyncExternalStore } from 'react'

export type PanelKind = 'new' | 'progress' | 'computer' | 'changes' | 'files' | 'terminal' | 'agent' | 'file'

export type PanelTab = { id: string; kind: PanelKind; fileId?: string }

type PanelState = { tabs: PanelTab[]; active: string; width: number; expanded: boolean }

const DEFAULT_WIDTH = 480
const STORAGE_KEY = 'overlay:mockup:workspace-panel'

function initialState(): PanelState {
  const fallback: PanelState = {
    tabs: [{ id: 'progress', kind: 'progress' }, { id: 'computer', kind: 'computer' }, { id: 'changes', kind: 'changes' }],
    active: 'progress',
    width: DEFAULT_WIDTH,
    expanded: false,
  }
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as PanelState | null
    return saved && Array.isArray(saved.tabs) && saved.tabs.length > 0 ? { ...fallback, ...saved } : fallback
  } catch {
    return fallback
  }
}

// The mockup opens with the panel showing, so the proposal is the first thing on screen.
try {
  if (!window.localStorage.getItem('overlay:agent-right-sidebar')) {
    window.localStorage.setItem('overlay:agent-right-sidebar', JSON.stringify({ open: true, tab: 'details' }))
  }
} catch { /* blocked storage */ }

let state: PanelState = initialState()
const listeners = new Set<() => void>()

function set(next: Partial<PanelState>) {
  state = { ...state, ...next }
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* blocked storage */ }
  listeners.forEach((listener) => listener())
}

export function usePanelState(): PanelState {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => state,
    () => state,
  )
}

function tabId(kind: PanelKind, fileId?: string) {
  return kind === 'file' ? `file:${fileId}` : kind === 'new' ? `new:${Date.now()}` : kind
}

/** Singleton kinds focus their existing tab; a file opens once per file; "new" always opens a fresh launcher. */
export function openTab(kind: PanelKind, fileId?: string) {
  const id = tabId(kind, fileId)
  if (state.tabs.some((tab) => tab.id === id)) return set({ active: id })
  set({ tabs: [...state.tabs, { id, kind, fileId }], active: id })
}

/** The launcher turns into whatever it opens, the way a browser's new tab navigates in place. */
export function replaceTab(fromId: string, kind: PanelKind, fileId?: string) {
  const id = tabId(kind, fileId)
  if (state.tabs.some((tab) => tab.id === id)) {
    return set({ tabs: state.tabs.filter((tab) => tab.id !== fromId), active: id })
  }
  set({ tabs: state.tabs.map((tab) => (tab.id === fromId ? { id, kind, fileId } : tab)), active: id })
}

export function closeTab(id: string) {
  const index = state.tabs.findIndex((tab) => tab.id === id)
  const tabs = state.tabs.filter((tab) => tab.id !== id)
  if (tabs.length === 0) {
    const fresh = tabId('new')
    return set({ tabs: [{ id: fresh, kind: 'new' }], active: fresh })
  }
  set({ tabs, active: state.active === id ? tabs[Math.max(0, index - 1)].id : state.active })
}

export function selectTab(id: string) {
  set({ active: id })
}

export function toggleExpanded() {
  set({ expanded: !state.expanded })
}

export function resizePanel(width: number) {
  set({ width, expanded: false })
}

/** The docked width: the dragged width, or most of the window when expanded. */
export function usePanelWidth(): number {
  const { width, expanded } = usePanelState()
  if (!expanded || typeof window === 'undefined') return width
  return Math.max(width, Math.round(window.innerWidth - 60 - 272 - 400))
}
