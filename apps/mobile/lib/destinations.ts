import type {
  AppDestinationConfig,
  AppFeatureFlags,
  CapabilityCheck,
  OverlayFeatureFlagId,
} from '@overlay/app-core'
import type { Feather } from '@expo/vector-icons'

export type FeatherIconName = React.ComponentProps<typeof Feather>['name']

export interface DestinationSession {
  featureFlags: AppFeatureFlags
  capabilities: CapabilityCheck
  isFeatureEnabled: (flagId: OverlayFeatureFlagId) => boolean
}

export interface ResolvedNavItem {
  id: string
  label: string
  route: string | null
  sfSymbol: string
  featherIcon: FeatherIconName
}

const MOBILE_DESTINATIONS: readonly ResolvedNavItem[] = [
  { id: 'work', label: 'Work', route: '/(tabs)/work', sfSymbol: 'checklist', featherIcon: 'check-square' },
  { id: 'agents', label: 'Agents', route: '/(tabs)/agents', sfSymbol: 'sparkles', featherIcon: 'cpu' },
  { id: 'chat', label: 'Chats', route: '/(tabs)/chat', sfSymbol: 'bubble.left.and.bubble.right', featherIcon: 'message-circle' },
  { id: 'files', label: 'Files', route: '/(tabs)/files', sfSymbol: 'folder', featherIcon: 'folder' },
  { id: 'automations', label: 'Automations', route: '/(tabs)/automations', sfSymbol: 'bolt.badge.clock', featherIcon: 'zap' },
  { id: 'extensions', label: 'Extensions', route: '/(tabs)/tools', sfSymbol: 'puzzlepiece.extension', featherIcon: 'tool' },
]

export function isDestinationEnabled(id: string, session: DestinationSession): boolean {
  switch (id) {
    case 'work':
      return true
    case 'agents':
      return session.isFeatureEnabled('agents')
    case 'chat':
      return session.capabilities.chat
    case 'files':
      return session.capabilities.files
    case 'extensions':
      return session.isFeatureEnabled('extensions')
    case 'automations':
      return session.isFeatureEnabled('automations')
    default:
      return false
  }
}

export function resolveNavDestinations(
  destinations: readonly AppDestinationConfig[],
  session: DestinationSession,
): ResolvedNavItem[] {
  return MOBILE_DESTINATIONS.filter((item) =>
    (item.id === 'work' || destinations.some((destination) => destination.id === item.id))
    && isDestinationEnabled(item.id, session),
  )
}
