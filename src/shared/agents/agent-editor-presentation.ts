/**
 * Remembers whether the agent editor was last used as a floating dialog or a
 * docked side panel so the settings gear reopens whichever shape the user
 * left it in. Persists in localStorage (guarded for private browsing).
 */

const STORAGE_KEY = 'overlay:agent-editor-presentation'

export type AgentEditorPanelMode = 'dialog' | 'side'

export function getAgentEditorPanelMode(): AgentEditorPanelMode {
  if (typeof window === 'undefined') return 'dialog'
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'side' ? 'side' : 'dialog'
  } catch {
    return 'dialog'
  }
}

export function setAgentEditorPanelMode(mode: AgentEditorPanelMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Private browsing / quota — lose the preference rather than crash chrome.
  }
}
