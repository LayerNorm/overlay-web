export type AppDestinationId =
  | 'chat'
  | 'files'
  | 'notes'
  | 'extensions'
  | 'automations'
  | 'settings'
  | 'account'

export type KnowledgeSubview = 'memories' | 'files' | 'outputs'
export type ExtensionsSubview = 'connectors' | 'skills' | 'mcps' | 'apps' | 'all'
export type SettingsSubview =
  | 'general'
  | 'account'
  | 'customization'
  | 'memories'
  | 'providers'
  | 'models'
  | 'contact'
export interface AppDestinationConfig {
  id: AppDestinationId
  label: string
  href: string
  subviews?: readonly string[]
}

export const CANONICAL_APP_DESTINATIONS: readonly AppDestinationConfig[] = [
  { id: 'chat', label: 'Chat', href: '/app/chat' },
  {
    id: 'files',
    label: 'Files',
    href: '/app/files',
    subviews: ['files', 'outputs'],
  },
  {
    id: 'extensions',
    label: 'Extensions',
    href: '/app/tools',
    subviews: ['connectors', 'skills', 'mcps', 'apps', 'all'],
  },
  { id: 'automations', label: 'Automations', href: '/app/automations' },
  {
    id: 'settings',
    label: 'Settings',
    href: '/app/settings',
    subviews: ['general', 'account', 'customization', 'providers', 'models', 'contact'],
  },
  { id: 'account', label: 'Account settings', href: '/app/settings?section=account' },
] as const

export interface AppFeatureFlags {
  canUseVoiceTranscription: boolean
  canUseKnowledge: boolean
  canUseAutomations: boolean
  canUseExtensions: boolean
}
