import type { InlineNavItem, PanelScope } from '@overlay/shell-react'

export type ActiveTool =
  | 'home'
  | 'chat'
  | 'agents'
  | 'files'
  | 'extensions'
  | 'automations'
  | 'voice'
  | 'browser'

export interface DesktopShellNavState {
  page: ActiveTool
  scope: PanelScope
  itemId: string | null
  settingsSection: string
  collapsed: boolean
}

export const DESKTOP_SETTINGS_ITEMS: readonly InlineNavItem[] = [
  { id: 'general', label: 'General' },
  { id: 'chat', label: 'Customization' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'memories', label: 'Memories' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'models', label: 'Models' },
  { id: 'transcription', label: 'Voice' },
  { id: 'assistant', label: 'Overlay pill' },
  { id: 'output', label: 'Output' },
  { id: 'notebook', label: 'Notebook' },
  { id: 'browser', label: 'Browser' },
]

export const DESKTOP_SETTINGS_GROUPS = [
  { label: 'Personal', ids: ['general', 'chat', 'shortcuts', 'memories'] },
  { label: 'Workspace', ids: ['workspace', 'models'] },
  { label: 'This Mac', ids: ['transcription', 'assistant', 'output', 'notebook', 'browser'] },
] as const

export const DESKTOP_MORE_GROUPS = [
  { ids: ['files', 'extensions'] },
  { label: 'This Mac', ids: ['voice', 'browser'] },
] as const

export function activeToolForTarget(target: string): ActiveTool | null {
  switch (target) {
    case 'home':
    case 'agents':
    case 'chats':
    case 'chat':
    case 'automations':
    case 'files':
    case 'extensions':
    case 'voice':
    case 'browser':
      return target === 'chats' ? 'chat' : target
    case 'projects':
      return 'files'
    case 'transcriptions':
      return 'voice'
    default:
      return null
  }
}

export function workspaceNavStorageKey(workspaceId: string | null): string {
  return `overlay-desktop-shell-nav:${workspaceId ?? 'no-workspace'}`
}

const DEFAULT_NAV: DesktopShellNavState = {
  page: 'home',
  scope: 'personal',
  itemId: null,
  settingsSection: 'general',
  collapsed: false,
}

export function readDesktopShellNav(
  storage: Pick<Storage, 'getItem'>,
  workspaceId: string | null,
): DesktopShellNavState {
  try {
    const raw = storage.getItem(workspaceNavStorageKey(workspaceId))
    if (!raw) return { ...DEFAULT_NAV }
    const saved = JSON.parse(raw) as Partial<DesktopShellNavState>
    const page = activeToolForTarget(String(saved.page ?? ''))
    return {
      page: page ?? DEFAULT_NAV.page,
      scope: saved.scope === 'workspace' ? 'workspace' : 'personal',
      itemId: typeof saved.itemId === 'string' ? saved.itemId : null,
      settingsSection:
        typeof saved.settingsSection === 'string' ? saved.settingsSection : DEFAULT_NAV.settingsSection,
      collapsed: saved.collapsed === true,
    }
  } catch {
    return { ...DEFAULT_NAV }
  }
}

export function writeDesktopShellNav(
  storage: Pick<Storage, 'setItem'>,
  workspaceId: string | null,
  state: DesktopShellNavState,
): void {
  try {
    storage.setItem(workspaceNavStorageKey(workspaceId), JSON.stringify(state))
  } catch {
    // Storage may be disabled in restricted renderer contexts.
  }
}

export function settingsItemGroups(
  items: readonly InlineNavItem[],
): ReadonlyArray<{ label: string; ids: readonly string[] }> {
  return DESKTOP_SETTINGS_GROUPS.map(({ label, ids }) => ({
    label,
    ids: ids.filter((id) => items.some((item) => item.id === id)),
  })).filter((group) => group.ids.length > 0)
}
