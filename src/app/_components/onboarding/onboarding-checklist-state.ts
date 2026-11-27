export const CHECKLIST_ITEMS = [
  { id: 'first-task', label: 'Start your first task', href: null },
  { id: 'invite', label: 'Invite a teammate', href: '/app/settings?section=workspace' },
  { id: 'memories', label: 'Import memories from ChatGPT or Claude', href: '/app/settings?section=memories' },
  { id: 'subscription', label: 'Connect your AI subscription', href: '/app/settings?section=providers' },
  { id: 'tools', label: 'Connect tools (Gmail, Calendar…)', href: '/app/settings?section=connected-apps' },
  { id: 'slack', label: 'Connect Slack', href: '/app/settings?section=connected-apps&app=slack' },
  { id: 'desktop', label: 'Get the desktop app', href: '/download' },
] as const
export type ChecklistItemId = typeof CHECKLIST_ITEMS[number]['id']
export type ChecklistState = { enabled: boolean; dismissed: boolean; tooltipSeen: boolean; done: ChecklistItemId[] }

const key = (workspaceId: string) => `overlay:onboarding-checklist:${workspaceId}`
const EMPTY: ChecklistState = { enabled: false, dismissed: false, tooltipSeen: false, done: [] }

export function parseChecklistState(raw: string | null): ChecklistState {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<ChecklistState> | null
    if (!value || typeof value !== 'object') return EMPTY
    const ids = new Set<string>(CHECKLIST_ITEMS.map((item) => item.id))
    return {
      enabled: value.enabled === true, dismissed: value.dismissed === true, tooltipSeen: value.tooltipSeen === true,
      done: Array.isArray(value.done) ? [...new Set(value.done.filter((id): id is ChecklistItemId => typeof id === 'string' && ids.has(id)))] : [],
    }
  } catch { return EMPTY }
}

export function readChecklist(workspaceId: string): ChecklistState {
  try { return parseChecklistState(window.localStorage.getItem(key(workspaceId))) } catch { return EMPTY }
}

export function writeChecklist(workspaceId: string, state: ChecklistState) {
  try { window.localStorage.setItem(key(workspaceId), JSON.stringify(state)) } catch { /* private mode */ }
  window.dispatchEvent(new Event('overlay:onboarding-checklist'))
}

/** Called when onboarding v2 finishes: the checklist appears with the first task already done. */
export function enableChecklist(workspaceId: string) {
  const current = readChecklist(workspaceId)
  writeChecklist(workspaceId, { ...current, enabled: true, done: [...new Set<ChecklistItemId>([...current.done, 'first-task'])] })
}

export function checklistVisible(state: ChecklistState): boolean {
  return state.enabled && !state.dismissed && state.done.length < CHECKLIST_ITEMS.length
}
