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
  /** Expo Router path. `null` means the destination exists but has no mobile
   *  surface yet — render it disabled with a "Soon" badge. */
  route: string | null
  sfSymbol: string
  featherIcon: FeatherIconName
}

interface MobileDestinationMapEntry {
  route: string | null
  sfSymbol: string
  featherIcon: FeatherIconName
  /** Skip from the sidebar list (e.g. account — covered by the bottom bar). */
  hideInNav?: boolean
}

/**
 * Maps web app destinations (bootstrap `destinations`, derived from the shared
 * navigation registry) onto Expo Router routes. Destinations without a mobile
 * route stay visible but disabled so the drawer reflects the full web surface
 * instead of silently dropping entries.
 */
const MOBILE_DESTINATION_MAP: Record<string, MobileDestinationMapEntry> = {
  agents: { route: '/(tabs)/agents', sfSymbol: 'sparkles', featherIcon: 'cpu' },
  chat: { route: '/(tabs)/chat', sfSymbol: 'bubble.left.and.bubble.right', featherIcon: 'message-circle' },
  // Activity is a chat subview on web; on mobile it is its own surface
  // injected after Chat (like Notes) when collaboration is enabled.
  activity: { route: '/(tabs)/activity', sfSymbol: 'bell', featherIcon: 'bell' },
  // Notes are mobile-only (no web destination) — injected after chat below.
  notes: { route: '/(tabs)/notes', sfSymbol: 'note.text', featherIcon: 'book-open' },
  // Until dedicated Files screens land (Phase 5), the destination opens the
  // files view inside Knowledge.
  files: { route: '/(tabs)/knowledge?tab=files', sfSymbol: 'folder', featherIcon: 'folder' },
  knowledge: { route: '/(tabs)/knowledge', sfSymbol: 'books.vertical', featherIcon: 'database' },
  extensions: { route: '/(tabs)/tools', sfSymbol: 'puzzlepiece.extension', featherIcon: 'tool' },
  projects: { route: '/(tabs)/projects', sfSymbol: 'tray.2', featherIcon: 'layers' },
  automations: { route: '/(tabs)/automations', sfSymbol: 'bolt.badge.clock', featherIcon: 'zap' },
  settings: { route: '/(tabs)/settings', sfSymbol: 'gearshape', featherIcon: 'settings' },
  account: { route: '/(tabs)/settings', sfSymbol: 'person.crop.circle', featherIcon: 'user', hideInNav: true },
}

/**
 * Feature gates per destination id. `isFeatureEnabled` consults the bootstrap
 * feature-flag registry including its required capabilities, so a flag flip on
 * the server hides the destination here and in the tab screens together.
 */
export function isDestinationEnabled(id: string, session: DestinationSession): boolean {
  switch (id) {
    case 'agents':
      return session.isFeatureEnabled('agents')
    case 'chat':
      return session.capabilities.chat
    case 'files':
      // Files live under the knowledge umbrella on mobile for now.
      return session.capabilities.files
        && session.isFeatureEnabled('knowledge')
        && session.featureFlags.canUseKnowledge
    case 'knowledge':
      return session.isFeatureEnabled('knowledge') && session.featureFlags.canUseKnowledge
    case 'extensions':
      return session.isFeatureEnabled('extensions')
    case 'projects':
      return session.isFeatureEnabled('projects')
    case 'automations':
      return session.isFeatureEnabled('automations')
    case 'notes':
      return true
    default:
      return true
  }
}

const NOTES_DESTINATION_ID = 'notes'
const ACTIVITY_DESTINATION_ID = 'activity'

function isActivityEnabled(session: DestinationSession): boolean {
  return (
    session.capabilities.chat &&
    (session.isFeatureEnabled('collaborativeChats') || session.isFeatureEnabled('channels'))
  )
}

/**
 * Resolves bootstrap destinations into sidebar items: filters by flags and
 * capabilities, maps to mobile routes, and injects the mobile-only Notes entry
 * after Chat (or first when chat is unavailable).
 */
export function resolveNavDestinations(
  destinations: readonly AppDestinationConfig[],
  session: DestinationSession,
): ResolvedNavItem[] {
  const items: ResolvedNavItem[] = []
  let chatSeen = false

  for (const destination of destinations) {
    const entry = MOBILE_DESTINATION_MAP[destination.id]
    if (!entry || entry.hideInNav || !isDestinationEnabled(destination.id, session)) {
      continue
    }
    if (destination.id === 'chat') {
      chatSeen = true
    }
    items.push({
      id: destination.id,
      label: destination.label,
      route: entry.route,
      sfSymbol: entry.sfSymbol,
      featherIcon: entry.featherIcon,
    })
  }

  // Mobile-injected entries after Chat: Activity (when collaboration is on)
  // then Notes.
  const chatIndex = items.findIndex((item) => item.id === 'chat')
  const insertAt = chatSeen && chatIndex >= 0 ? chatIndex + 1 : 0
  const injected: ResolvedNavItem[] = []
  if (isActivityEnabled(session)) {
    const entry = MOBILE_DESTINATION_MAP[ACTIVITY_DESTINATION_ID]
    injected.push({
      id: ACTIVITY_DESTINATION_ID,
      label: 'Activity',
      route: entry.route,
      sfSymbol: entry.sfSymbol,
      featherIcon: entry.featherIcon,
    })
  }
  const notesEntry = MOBILE_DESTINATION_MAP[NOTES_DESTINATION_ID]
  injected.push({
    id: NOTES_DESTINATION_ID,
    label: 'Notes',
    route: notesEntry.route,
    sfSymbol: notesEntry.sfSymbol,
    featherIcon: notesEntry.featherIcon,
  })
  items.splice(insertAt, 0, ...injected)

  return items
}
