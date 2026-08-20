/**
 * Single source of truth for app-wide keyboard shortcuts.
 *
 * Handlers bind `hotkey` through `react-hotkeys-hook` (see `useAppHotkey`), and
 * the Settings → Shortcuts panel renders `keys` for the same entries, so the
 * documented chord can never drift from the one that is actually bound.
 *
 * `Mod` renders as ⌘ on Apple platforms and Ctrl everywhere else, matching the
 * `mod` modifier in react-hotkeys-hook.
 */

export type ShortcutGroupId = 'global' | 'navigation' | 'chat' | 'composer' | 'search'

export interface ShortcutDefinition {
  id: string
  label: string
  description: string
  group: ShortcutGroupId
  /**
   * react-hotkeys-hook key string. Omitted for shortcuts that are handled by a
   * component-local handler (e.g. Enter inside the composer) and only need to be
   * documented.
   */
  hotkey?: string
  /** Display chords. Each entry is one chord, e.g. `['Mod', 'K']`. */
  keys: string[][]
}

export interface ShortcutGroup {
  id: ShortcutGroupId
  label: string
  description: string
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  { id: 'global', label: 'Global', description: 'Available anywhere in the app.' },
  { id: 'navigation', label: 'Navigation', description: 'Jump between the main sidebar surfaces.' },
  { id: 'search', label: 'Search', description: 'Inside the command palette (⌘K).' },
  { id: 'chat', label: 'Chat', description: 'While a chat surface is open.' },
  { id: 'composer', label: 'Composer', description: 'While writing a message.' },
] as const

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: 'global.search',
    label: 'Open search',
    description: 'Open the command palette to search chats, files, agents, projects, and extensions.',
    group: 'global',
    hotkey: 'mod+k',
    keys: [['Mod', 'K']],
  },
  {
    id: 'navigation.section',
    label: 'Go to sidebar section',
    description: 'Jump to the 1st through 6th item in the sidebar (Chat, Files, Tools, …).',
    group: 'navigation',
    hotkey: 'alt+1,alt+2,alt+3,alt+4,alt+5,alt+6',
    keys: [['Alt', '1'], ['Alt', '…'], ['Alt', '6']],
  },
  {
    id: 'navigation.settings',
    label: 'Go to settings',
    description: 'Open the settings surface.',
    group: 'navigation',
    hotkey: 'alt+7',
    keys: [['Alt', '7']],
  },
  {
    id: 'search.move',
    label: 'Move between results',
    description: 'Move the highlighted row up or down in the command palette.',
    group: 'search',
    keys: [['↑'], ['↓']],
  },
  {
    id: 'search.open',
    label: 'Open highlighted result',
    description: 'Open the highlighted result, or drill into the highlighted category.',
    group: 'search',
    keys: [['Enter']],
  },
  {
    id: 'search.back',
    label: 'Back / close',
    description: 'Leave the current category, or close the palette when at the top level.',
    group: 'search',
    keys: [['Esc']],
  },
  {
    id: 'chat.model-picker',
    label: 'Toggle model picker',
    description: 'Show or hide the model selector for the active chat.',
    group: 'chat',
    keys: [['Mod', 'Shift', '/']],
  },
  {
    id: 'chat.generation-mode',
    label: 'Cycle generation mode',
    description: 'Switch the composer between text, image, and video generation.',
    group: 'chat',
    keys: [['Mod', 'Shift', '.']],
  },
  {
    id: 'chat.focus-composer',
    label: 'Focus the composer',
    description: 'Jump straight to the message box from anywhere in the chat.',
    group: 'chat',
    keys: [['/']],
  },
  {
    id: 'composer.send',
    label: 'Send message',
    description: 'Send the current draft.',
    group: 'composer',
    keys: [['Enter']],
  },
  {
    id: 'composer.newline',
    label: 'New line',
    description: 'Insert a line break without sending.',
    group: 'composer',
    keys: [['Shift', 'Enter']],
  },
  {
    id: 'composer.mention',
    label: 'Mention something',
    description: 'Open the mention picker for files, knowledge bases, skills, MCP servers, and connectors.',
    group: 'composer',
    keys: [['@']],
  },
  {
    id: 'composer.mention-accept',
    label: 'Accept mention',
    description: 'Insert the highlighted mention suggestion.',
    group: 'composer',
    keys: [['Enter'], ['Tab']],
  },
  {
    id: 'composer.save-edit',
    label: 'Save inline edit',
    description: 'Commit an inline message edit or a new memory.',
    group: 'composer',
    keys: [['Mod', 'Enter']],
  },
] as const

export function getShortcut(id: string): ShortcutDefinition | undefined {
  return SHORTCUTS.find((shortcut) => shortcut.id === id)
}

/** Throws in development if an id is renamed without updating its binding. */
export function requireShortcutHotkey(id: string): string {
  const shortcut = getShortcut(id)
  if (!shortcut?.hotkey) {
    throw new Error(`Shortcut "${id}" has no hotkey binding`)
  }
  return shortcut.hotkey
}

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

const APPLE_KEY_LABELS: Record<string, string> = {
  Mod: '⌘',
  Alt: '⌥',
  Shift: '⇧',
  Ctrl: '⌃',
  Enter: '↩',
  Esc: 'esc',
}

const OTHER_KEY_LABELS: Record<string, string> = {
  Mod: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Ctrl: 'Ctrl',
  Enter: 'Enter',
  Esc: 'Esc',
}

export function formatShortcutKey(key: string, apple: boolean): string {
  const labels = apple ? APPLE_KEY_LABELS : OTHER_KEY_LABELS
  return labels[key] ?? key
}
