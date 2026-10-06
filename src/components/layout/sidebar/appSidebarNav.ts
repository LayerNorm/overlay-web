import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  Brain,
  Cloud,
  CreditCard,
  FileText,
  House,
  Keyboard,
  Plug,
  LayoutDashboard,
  Mail,
  Monitor,
  Palette,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  User,
  UserCog,
  UsersRound,
  Webhook,
  X,
} from 'lucide-react'
import type { OverlayNavigationItem, OverlaySidebarAction } from '@overlay/app-core'
import type { GateReason } from '@/components/providers/GuestGateProvider'
import {
  NEW_CHANNEL_EVENT,
  NEW_DIRECT_MESSAGE_EVENT,
} from '@/shared/chat/collaboration-events'
import { NEW_AGENT_EVENT } from '@/shared/workspace/sidebar-events'
import { MARKETING_DOCS_URL } from '@/shared/marketing/marketing'
import { ROOT_APP_DESTINATION } from '@/shared/auth/root-entry'
import { resolveFilesCategory, type FilesCategory } from '@/components/layout/FilesCategorySidebar'
import type { AgentsPanelView } from '@/components/layout/sidebar-nav'
import { PANEL_SCOPE_PARAM, resolvePanelScope, type PanelScope } from '@/shared/workspaces/panel-scope'
import type { PrimaryRailItem } from './AppSidebarPrimaryRail'

export type SecondaryPanelKind = 'chat' | 'files' | 'notes' | 'agents' | 'automations' | 'tools' | 'settings'

export const PANEL_KIND_TITLES: Record<SecondaryPanelKind, string> = {
  chat: 'chats',
  files: 'files',
  notes: 'notes',
  agents: 'agents',
  automations: 'automations',
  tools: 'extensions',
  settings: 'settings',
}

export const SETTINGS_SECTION_ICONS: Record<string, LucideIcon> = {
  general: Settings,
  account: User,
  customization: Palette,
  shortcuts: Keyboard,
  memories: Brain,
  providers: Cloud,
  models: Bot,
  computers: Monitor,
  'agent-environments': Server,
  'agent-accounts': UserCog,
  'connected-apps': Plug,
  webhooks: Webhook,
  contact: Mail,
  workspace: UsersRound,
}

/** Sidebar navigation chords stay inert while typing and ignore key repeat. */
export const NAV_HOTKEY_OPTIONS = {
  preventDefault: true,
  ignoreEventWhen: (event: KeyboardEvent) => event.repeat,
} as const

export const RESOURCE_PANEL_KINDS: ReadonlySet<SecondaryPanelKind> = new Set([
  'chat',
  'files',
  'notes',
  'agents',
  'automations',
])

export type SidebarNavItem = Omit<OverlayNavigationItem, 'icon'> & { icon: LucideIcon }

export interface SidebarRouteState {
  workspaceSurface: string | null
  canonicalWorkspaceRoute: boolean
  notesOpen: boolean
  filesOpen: boolean
  filesSectionOpen: boolean
  agentsOpen: boolean
  activityOpen: boolean
  archivedOpen: boolean
  chatOpen: boolean
  adminOpen: boolean
  automationsOpen: boolean
  automationsSectionOpen: boolean
  toolsOpen: boolean
  settingsPathActive: boolean
  settingsSection: string
  toolsView: string
  filesView: FilesCategory
  agentsView: AgentsPanelView
  chatViewParam: string | null
  chatsView: string
  /** Personal, Workspace, or Archived, from the URL, then the remembered choice. Chats derive it from their subview. */
  scope: PanelScope
  panelKind: SecondaryPanelKind | null
  hasResourcePanel: boolean
  showSecondaryPanel: boolean
}

function resolveToolsView(current: string | null): string {
  if (current === 'skills') return 'skills'
  if (current === 'mcps') return 'mcps'
  if (current === 'apps') return 'apps'
  if (current === 'installed') return 'installed'
  return 'connectors'
}

/** Chats keep their own routes: direct messages, channels, and activity are the Workspace scope; archived chats are Archived. */
export function chatScopeForView(chatsView: string): PanelScope {
  if (chatsView === 'archived') return 'archived'
  if (chatsView === 'dms' || chatsView === 'channels' || chatsView === 'activity') return 'workspace'
  return 'personal'
}

function resolveChatsView({
  activityOpen,
  archivedOpen,
  chatViewParam,
}: {
  activityOpen: boolean
  archivedOpen: boolean
  chatViewParam: string | null
}): string {
  if (activityOpen) return 'activity'
  if (archivedOpen) return 'archived'
  if (chatViewParam === 'dms') return 'dms'
  if (chatViewParam === 'channels') return 'channels'
  if (chatViewParam === 'all') return 'all'
  return 'personal'
}

export function resolveSidebarRouteState({
  pathname,
  searchParams,
  resolveWorkspaceSurface,
  automationsEnabled,
  savedScope = null,
}: {
  pathname: string
  searchParams: URLSearchParams
  resolveWorkspaceSurface: (path: string) => string | null
  automationsEnabled: boolean
  /** The scope remembered from the last scoped page. */
  savedScope?: PanelScope | null
}): SidebarRouteState {
  const workspaceSurface = resolveWorkspaceSurface(pathname)
  const canonicalWorkspaceRoute = pathname.startsWith('/app/w/')
  const notesOpen = pathname.startsWith('/app/notes') || (canonicalWorkspaceRoute && workspaceSurface === 'notes')
  const filesOpen = pathname.startsWith('/app/files') || (canonicalWorkspaceRoute && workspaceSurface === 'files')
  const filesSectionOpen = filesOpen || notesOpen
  const agentsOpen = pathname.startsWith('/app/agents') || (canonicalWorkspaceRoute && workspaceSurface === 'agents')
  // Activity is its own page but stays under the Chats secondary panel, so the
  // subnavigation it was selected from remains visible beside it.
  const activityOpen = pathname.startsWith('/app/activity') || (canonicalWorkspaceRoute && workspaceSurface === 'activity')
  // Archived is its own page but belongs to the Chats panel too, so selecting it
  // keeps the same subnavigation beside it.
  const archivedOpen = pathname.startsWith('/app/archived') || (canonicalWorkspaceRoute && workspaceSurface === 'archived')
  const chatOpen = activityOpen || archivedOpen || pathname.startsWith('/app/chat') || (canonicalWorkspaceRoute && workspaceSurface === 'chat')
  const adminOpen = pathname.startsWith('/app/admin') || (canonicalWorkspaceRoute && workspaceSurface === 'admin')
  const automationsOpen = pathname.startsWith('/app/automations') || (canonicalWorkspaceRoute && workspaceSurface === 'automations')
  const automationsSectionOpen = automationsOpen && automationsEnabled
  const toolsOpen = pathname.startsWith('/app/tools') || (canonicalWorkspaceRoute && workspaceSurface === 'tools')
  const settingsPathActive = pathname.startsWith('/app/settings') || (canonicalWorkspaceRoute && workspaceSurface === 'settings')
  const settingsSection = searchParams.get('section') ?? 'general'
  const chatViewParam = searchParams.get('view')
  const toolsView = resolveToolsView(chatViewParam)
  const filesView = resolveFilesCategory(chatViewParam)
  const chatsView = resolveChatsView({ activityOpen, archivedOpen, chatViewParam })
  // Agent links from before scopes carried the tab as `?view=`.
  const scopeParam = searchParams.get(PANEL_SCOPE_PARAM) ?? (agentsOpen ? chatViewParam : null)
  const scope = chatOpen ? chatScopeForView(chatsView) : resolvePanelScope({ param: scopeParam, saved: savedScope })
  const agentsView = scope
  const panelKind: SecondaryPanelKind | null = chatOpen
    ? 'chat'
    : filesOpen
      ? 'files'
      : notesOpen
        ? 'notes'
        : agentsOpen
          ? 'agents'
          : automationsSectionOpen
            ? 'automations'
            : toolsOpen
              ? 'tools'
              : settingsPathActive
                ? 'settings'
                : null
  return {
    workspaceSurface,
    canonicalWorkspaceRoute,
    notesOpen,
    filesOpen,
    filesSectionOpen,
    agentsOpen,
    activityOpen,
    archivedOpen,
    chatOpen,
    adminOpen,
    automationsOpen,
    automationsSectionOpen,
    toolsOpen,
    settingsPathActive,
    settingsSection,
    toolsView,
    filesView,
    agentsView,
    chatViewParam,
    chatsView,
    scope,
    panelKind,
    hasResourcePanel: panelKind != null && RESOURCE_PANEL_KINDS.has(panelKind),
    showSecondaryPanel: panelKind != null,
  }
}

export function resolveNavItemDestination(
  href: string,
  {
    publicShowcase,
    activeWorkspaceId,
    buildWorkspaceHref,
  }: {
    publicShowcase: boolean
    activeWorkspaceId: string | null
    buildWorkspaceHref: (workspaceId: string, href: string) => string
  },
): string {
  return publicShowcase
    ? `${href}?${new URLSearchParams({
        showcase: '1',
        ...(href === '/app/chat' ? { id: 'showcase-welcome' } : {}),
      }).toString()}`
    : activeWorkspaceId
      ? buildWorkspaceHref(activeWorkspaceId, href)
      : href
}

export function isSidebarNavItemActive(
  item: SidebarNavItem,
  {
    resolveWorkspaceSurface,
    effectivePendingHref,
    filesSectionOpen,
    canonicalWorkspaceRoute,
    workspaceSurface,
    pathname,
  }: {
    resolveWorkspaceSurface: (path: string) => string | null
    effectivePendingHref: string | null
    filesSectionOpen: boolean
    canonicalWorkspaceRoute: boolean
    workspaceSurface: string | null
    pathname: string
  },
): boolean {
  const { href } = item
  if (!href) return false
  const hrefSurface = resolveWorkspaceSurface(href)
  if (effectivePendingHref) {
    const pendingSurface = resolveWorkspaceSurface(effectivePendingHref)
    return effectivePendingHref === href || pendingSurface === hrefSurface
  }
  if (href === '/app/files') return filesSectionOpen
  if (canonicalWorkspaceRoute) return workspaceSurface === hrefSurface
  return pathname.startsWith(href)
}

export function panelKindForNavItem(
  item: SidebarNavItem,
  automationsEnabled: boolean,
): SecondaryPanelKind | null {
  switch (item.href) {
    case '/app/chat':
      return 'chat'
    case '/app/files':
      return 'files'
    case '/app/agents':
      return 'agents'
    case '/app/automations':
      return automationsEnabled ? 'automations' : null
    case '/app/tools':
      return 'tools'
    default:
      return null
  }
}

export function gateSidebarNavItem(
  item: SidebarNavItem,
  {
    isGuestConfirmed,
    publicShowcase,
    requireAuth,
    primaryNavActionByItemId,
    runSidebarAction,
  }: {
    isGuestConfirmed: boolean
    publicShowcase: boolean
    requireAuth: (reason: GateReason) => void
    primaryNavActionByItemId: ReadonlyMap<string, OverlaySidebarAction>
    runSidebarAction: (action: OverlaySidebarAction) => Promise<boolean>
  },
): 'action' | 'gated' | 'ok' {
  if (!item.href || item.disabled) return 'gated'
  if (isGuestConfirmed && !publicShowcase && item.href !== '/app/chat') {
    requireAuth('nav')
    return 'gated'
  }
  const primaryNavAction = primaryNavActionByItemId.get(item.id)
  if (primaryNavAction) {
    void runSidebarAction(primaryNavAction)
    return 'action'
  }
  return 'ok'
}

export function selectSidebarNavItem(
  item: SidebarNavItem,
  ctx: {
    isGuestConfirmed: boolean
    publicShowcase: boolean
    requireAuth: (reason: GateReason) => void
    primaryNavActionByItemId: ReadonlyMap<string, OverlaySidebarAction>
    runSidebarAction: (action: OverlaySidebarAction) => Promise<boolean>
    isActive: (item: SidebarNavItem) => boolean
    destination: (href: string) => string
    pathname: string
    router: { push: (href: string) => void }
    setPendingNav: (nav: { href: string; fromPath: string }) => void
    panelKind: SecondaryPanelKind | null
    sidebarCollapsed: boolean
    setSidebarCollapsed: (next: boolean) => void
  },
) {
  if (gateSidebarNavItem(item, ctx) !== 'ok' || !item.href) return
  if (ctx.isActive(item)) {
    // Clicking the current section re-opens its panel when it is hidden.
    if (ctx.panelKind && ctx.sidebarCollapsed) ctx.setSidebarCollapsed(false)
    return
  }
  const destination = ctx.destination(item.href)
  ctx.setPendingNav({ href: destination, fromPath: ctx.pathname })
  ctx.router.push(destination)
}

export function selectMobileNavItem(
  item: SidebarNavItem,
  ctx: {
    isGuestConfirmed: boolean
    publicShowcase: boolean
    requireAuth: (reason: GateReason) => void
    primaryNavActionByItemId: ReadonlyMap<string, OverlaySidebarAction>
    runSidebarAction: (action: OverlaySidebarAction) => Promise<boolean>
    isActive: (item: SidebarNavItem) => boolean
    destination: (href: string) => string
    pathname: string
    router: { push: (href: string) => void }
    setPendingNav: (nav: { href: string; fromPath: string }) => void
    automationsEnabled: boolean
    openPanel: () => void
    closeDrawer: () => void
  },
) {
  if (gateSidebarNavItem(item, ctx) !== 'ok' || !item.href) return
  if (!ctx.isActive(item)) {
    const destination = ctx.destination(item.href)
    ctx.setPendingNav({ href: destination, fromPath: ctx.pathname })
    ctx.router.push(destination)
  }
  // Two-step drawer: destinations with a contextual panel drill into it;
  // everything else navigates and closes.
  if (panelKindForNavItem(item, ctx.automationsEnabled)) ctx.openPanel()
  else ctx.closeDrawer()
}

export function selectMobileAdmin(ctx: {
  adminOpen: boolean
  pathname: string
  router: { push: (href: string) => void }
  setPendingNav: (nav: { href: string; fromPath: string }) => void
  closeMobileDrawer: () => void
}) {
  if (ctx.adminOpen) {
    ctx.closeMobileDrawer()
    return
  }
  ctx.setPendingNav({ href: '/app/admin', fromPath: ctx.pathname })
  ctx.router.push('/app/admin')
  ctx.closeMobileDrawer()
}

export async function signOutToLanding() {
  await fetch('/api/auth/sign-out', { method: 'POST' })
  window.location.href = '/'
}

export function resolveShowcasePrimaryLinks(publicShowcase: boolean): Array<{
  id: string
  label: string
  icon: LucideIcon
  href: string
}> {
  return publicShowcase
    ? [
      { id: 'app', label: 'App', icon: LayoutDashboard, href: ROOT_APP_DESTINATION },
      { id: 'home', label: 'Home', icon: House, href: '/home' },
      { id: 'manifesto', label: 'Manifesto', icon: ScrollText, href: '/manifesto' },
      { id: 'pricing', label: 'Pricing', icon: CreditCard, href: '/pricing' },
      { id: 'docs', label: 'Docs', icon: FileText, href: MARKETING_DOCS_URL },
    ]
    : []
}

export function resolveResourceAction({
  chatOpen,
  chatsView,
  contextualAction,
  panelKind,
  publicShowcase,
  requireAuth,
  runSidebarAction,
}: {
  chatOpen: boolean
  chatsView: string
  contextualAction: OverlaySidebarAction | null
  panelKind: SecondaryPanelKind | null
  publicShowcase: boolean
  requireAuth: (reason: GateReason) => void
  runSidebarAction: (action: OverlaySidebarAction) => Promise<boolean>
}): { label: string; onClick: () => void } | null {
  if (chatOpen && chatsView === 'dms') {
    return {
      label: 'New message',
      onClick: () => publicShowcase
        ? requireAuth('nav')
        : window.dispatchEvent(new CustomEvent(NEW_DIRECT_MESSAGE_EVENT)),
    }
  }
  if (chatOpen && chatsView === 'channels') {
    return {
      label: 'New channel',
      onClick: () => publicShowcase
        ? requireAuth('nav')
        : window.dispatchEvent(new CustomEvent(NEW_CHANNEL_EVENT)),
    }
  }
  if (contextualAction) {
    return {
      label: contextualAction.label,
      onClick: () => publicShowcase ? requireAuth('nav') : void runSidebarAction(contextualAction),
    }
  }
  if (panelKind === 'agents') {
    return {
      label: 'New agent',
      onClick: () => window.dispatchEvent(new CustomEvent(NEW_AGENT_EVENT)),
    }
  }
  return null
}

export interface PanelCreateRules {
  /** Whether the person may create this kind of thing in the Workspace scope. */
  canCreate: (kind: 'extension' | 'content', scope: 'personal' | 'workspace') => boolean
  /** Owners and admins always may; members follow the workspace's settings. */
  isManager: boolean
  memberCanCreateChannels: boolean
  memberCanCreateAgents: boolean
}

/**
 * The panel's New button for the scope on screen: none in Archived, none where the person is not allowed to create in the
 * Workspace scope (their admin decides), and in Workspace it says where the item will land.
 */
export function scopePanelAction({
  action,
  panelKind,
  scope,
  chatsView,
  rules,
}: {
  action: { label: string; onClick: () => void } | null
  panelKind: SecondaryPanelKind | null
  scope: PanelScope
  chatsView: string
  rules: PanelCreateRules
}): { label: string; onClick: () => void } | null {
  if (!action) return null
  if (scope === 'archived') return null
  if (scope === 'personal') return action
  if (panelKind === 'chat') {
    return chatsView === 'channels' && !rules.isManager && !rules.memberCanCreateChannels ? null : action
  }
  if (panelKind === 'agents') {
    return !rules.isManager && !rules.memberCanCreateAgents ? null : action
  }
  if (panelKind === 'files' || panelKind === 'notes' || panelKind === 'automations') {
    return rules.canCreate('content', 'workspace')
      ? { ...action, label: `${action.label} in workspace` }
      : null
  }
  return action
}

export function buildPrimaryRailItems({
  showAdminNavigation,
  adminOpen,
  effectivePendingHref,
  navItems,
  primaryNavActionByItemId,
  isGuestConfirmed,
  publicShowcase,
  cumulativeChatUnread,
  settingsPathActive,
  pathname,
  router,
  setPendingNav,
  navItemDestination,
  navItemActive,
  onSelectItem,
}: {
  showAdminNavigation: boolean
  adminOpen: boolean
  effectivePendingHref: string | null
  navItems: SidebarNavItem[]
  primaryNavActionByItemId: ReadonlyMap<string, OverlaySidebarAction>
  isGuestConfirmed: boolean
  publicShowcase: boolean
  cumulativeChatUnread: number
  settingsPathActive: boolean
  pathname: string
  router: { push: (href: string) => void }
  setPendingNav: (nav: { href: string; fromPath: string }) => void
  navItemDestination: (href: string) => string
  navItemActive: (item: SidebarNavItem) => boolean
  onSelectItem: (item: SidebarNavItem) => void
}): PrimaryRailItem[] {
  const railItems: PrimaryRailItem[] = []
  if (showAdminNavigation) {
    railItems.push({
      id: 'admin',
      label: 'Admin',
      icon: ShieldCheck,
      active: adminOpen,
      pending: effectivePendingHref === '/app/admin',
      href: navItemDestination('/app/admin'),
      onSelect: () => {
        if (adminOpen) return
        setPendingNav({ href: '/app/admin', fromPath: pathname })
        router.push('/app/admin')
      },
    })
  }
  navItems.forEach((item, navIdx) => {
    const shortcut = navIdx < 9 ? navIdx + 1 : null
    const canOpenDestinationInNewTab = Boolean(item.href)
      && !primaryNavActionByItemId.has(item.id)
      && (!isGuestConfirmed || publicShowcase || item.href === '/app/chat')
    railItems.push({
      id: item.id,
      label: item.label,
      icon: item.icon,
      disabled: item.disabled,
      active: navItemActive(item),
      pending: Boolean(item.href && effectivePendingHref === item.href),
      href: canOpenDestinationInNewTab && item.href ? navItemDestination(item.href) : undefined,
      badgeCount: item.href === '/app/chat' ? cumulativeChatUnread : 0,
      title: shortcut ? `${item.label} · ⌥${shortcut}` : item.label,
      dataTour: item.href === '/app/chat'
        ? 'nav-chat'
        : item.href === '/app/files'
          ? 'nav-knowledge'
          : item.href === '/app/tools'
            ? 'nav-extensions'
            : undefined,
      onSelect: () => onSelectItem(item),
    })
  })

  if (settingsPathActive && !publicShowcase) {
    // Settings has no entry in the primary rail, so surface its return action
    // after the regular navigation items while it is open.
    const chatDestination = navItemDestination('/app/chat')
    railItems.push({
      id: 'settings-close',
      label: 'Settings',
      icon: X,
      active: true,
      title: 'Settings',
      onSelect: () => {
        setPendingNav({ href: '/app/chat', fromPath: pathname })
        router.push(chatDestination)
      },
    })
  }

  return railItems
}

export function buildShowcaseRailFooterItems(
  links: Array<{ id: string; label: string; icon: LucideIcon; href: string }>,
  router: { push: (href: string) => void },
): PrimaryRailItem[] {
  return links.map((link) => ({
    id: link.id,
    label: link.label,
    icon: link.icon,
    title: link.label,
    onSelect: () => {
      if (/^https?:\/\//.test(link.href)) window.location.assign(link.href)
      else router.push(link.href)
    },
  }))
}

export interface MobileNavItemVm {
  item: SidebarNavItem
  active: boolean
  pending: boolean
  unreadCount: number
  opensPanel: boolean
}

export function resolveMobileNavItems(
  navItems: SidebarNavItem[],
  {
    effectivePendingHref,
    cumulativeChatUnread,
    automationsEnabled,
    isActive,
  }: {
    effectivePendingHref: string | null
    cumulativeChatUnread: number
    automationsEnabled: boolean
    isActive: (item: SidebarNavItem) => boolean
  },
): MobileNavItemVm[] {
  return navItems.map((item) => ({
    item,
    active: isActive(item),
    pending: Boolean(item.href && effectivePendingHref === item.href),
    unreadCount: item.href === '/app/chat' ? cumulativeChatUnread : 0,
    opensPanel: panelKindForNavItem(item, automationsEnabled) != null,
  }))
}
