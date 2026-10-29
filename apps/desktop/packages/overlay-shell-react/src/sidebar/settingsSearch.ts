import type { InlineNavItem } from '../types'

const SETTINGS_GROUPS: ReadonlyArray<{ label: string; ids: readonly string[] }> = [
  { label: 'Personal', ids: ['general', 'customization', 'shortcuts', 'memories', 'archived'] },
  { label: 'Workspace', ids: ['profile', 'workspace', 'agent-accounts', 'agent-environments', 'computers', 'models', 'providers'] },
  { label: 'Integrations', ids: ['connected-apps', 'webhooks'] },
  { label: 'Support', ids: ['contact'] },
]

/** Words for the settings on each page, so a search for "theme" finds Customization. */
const SETTINGS_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  general: ['auto-continue', 'default model', 'open links', 'zdr', 'zero data retention', 'billing', 'plan', 'usage', 'subscription'],
  profile: ['display name', 'photo', 'avatar', 'account defaults'],
  workspace: ['members', 'invite', 'team', 'roles', 'permissions', 'workspace name'],
  customization: ['appearance', 'theme', 'dark mode', 'light mode', 'rail and panel', 'sidebar', 'layout'],
  shortcuts: ['keyboard', 'hotkeys', 'keybindings'],
  memories: ['memory', 'remember', 'knowledge'],
  providers: ['api key', 'byok', 'openai', 'anthropic', 'openrouter'],
  models: ['model catalog', 'default model', 'llm'],
  webhooks: ['events', 'callbacks', 'http'],
  'agent-environments': ['environments', 'sandbox', 'secrets', 'variables'],
  'agent-accounts': ['agents', 'connected agents', 'working details'],
  'connected-apps': ['mcp', 'oauth', 'tokens', 'apps', 'clients'],
  computers: ['computer', 'desktop', 'machine', 'cloud computer'],
  archived: ['archived chats', 'archive', 'restore'],
  contact: ['support', 'help', 'feedback', 'email us'],
  transcription: ['voice', 'dictation', 'microphone', 'speech'],
  assistant: ['pill', 'overlay pill', 'assistant'],
}

export interface SettingsNavGroup {
  label: string
  items: InlineNavItem[]
}

function matches(item: InlineNavItem, query: string): boolean {
  if (!query) return true
  const haystack = [item.label, item.id, ...(SETTINGS_KEYWORDS[item.id] ?? [])].join(' ').toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word))
}

/** Settings pages filtered by `query` and split into sidebar groups; empty groups are dropped. */
export function groupSettingsItems(
  items: ReadonlyArray<InlineNavItem>,
  query = '',
  settingsGroups: ReadonlyArray<{ label: string; ids: readonly string[] }> = SETTINGS_GROUPS,
): SettingsNavGroup[] {
  const visible = items.filter((item) => matches(item, query.trim()))
  const grouped = new Set<string>()
  const groups: SettingsNavGroup[] = settingsGroups.map((group) => {
    const groupItems = visible.filter((item) => group.ids.includes(item.id))
    groupItems.forEach((item) => grouped.add(item.id))
    return { label: group.label, items: groupItems }
  })
  const rest = visible.filter((item) => !grouped.has(item.id))
  if (rest.length > 0) groups.push({ label: 'More', items: rest })
  return groups.filter((group) => group.items.length > 0)
}
