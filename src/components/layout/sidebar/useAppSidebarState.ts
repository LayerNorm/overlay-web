'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useCallback, useMemo, useRef, useSyncExternalStore, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { MessageSquare } from 'lucide-react'
import {
  resolveOverlayAppShellConfig,
  resolveSidebarActionForPath,
} from '@overlay/app-core'
import { useAuth } from '@/contexts/AuthContext'
import { useGuestGate } from '@/components/providers/GuestGateProvider'
import { useAsyncSessions } from '@/components/providers/async-sessions-store'
import { toolsInlineItems } from '@/components/layout/sidebar-nav'
import overlayAppConfig from '@/overlay.config'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useAuthorization } from '@/components/providers/AuthorizationProvider'
import {
  getNavigationAuthorizationRequirement,
  getSettingsSectionAuthorizationRequirement,
  getSidebarActionAuthorizationRequirement,
} from '@/shared/authorization/client-policy'
import {
  getSidebarCollapsedSnapshot,
  setStoredSidebarCollapsed,
  subscribeToSidebarCollapsed,
} from './sidebarCollapsedStore'
import { ICON_COMPONENTS, toMentionCategory } from './sidebarNavigation'
import { useAppSidebarActions } from './useAppSidebarActions'
import {
  buildPrimaryRailItems,
  buildShowcaseRailFooterItems,
  isSidebarNavItemActive,
  PANEL_KIND_TITLES,
  resolveMobileNavItems,
  resolveNavItemDestination,
  resolveResourceAction,
  resolveShowcasePrimaryLinks,
  resolveSidebarRouteState,
  selectMobileAdmin,
  selectMobileNavItem,
  selectSidebarNavItem,
  type SidebarNavItem,
} from './appSidebarNav'
import { resolveSecondaryPanelNav } from './appSidebarPanelNav'
import {
  useBodyScrollLock,
  useClickOutside,
  useCollaborationUnread,
  useGlobalSearch,
  useSidebarEntitlements,
  useSidebarNavHotkeys,
  useTemporaryChatUiHidden,
  useUnreadChatRedirect,
} from './useSidebarEffects'
import type { AppSidebarProps, AppSidebarWorkspaceAdapter } from '../appSidebarTypes'

type SidebarNavConfigArgs = {
  appShell: ReturnType<typeof resolveOverlayAppShellConfig>
  capabilities: ReturnType<typeof useOverlayCapabilities>['capabilities']
  allows: ReturnType<typeof useAuthorization>['allows']
  publicShowcase: boolean
  user: ReturnType<typeof useAuth>['user']
}

function useSidebarNavConfig({ appShell, capabilities, allows, publicShowcase, user }: SidebarNavConfigArgs) {
  const availableToolsInlineItems = useMemo(
    () => toolsInlineItems.filter((item) => {
      if (item.id === 'skills') return capabilities.skills && allows({ all: ['skills.use'] })
      if (item.id === 'mcps') return capabilities.mcpServers && allows({ all: ['mcp.use'] })
      if (item.id === 'connectors') return capabilities.integrations && allows({ all: ['integrations.use'] })
      return true
    }),
    [allows, capabilities.integrations, capabilities.mcpServers, capabilities.skills],
  )
  const navItems = useMemo<SidebarNavItem[]>(
    () => appShell.navigation
      .filter((item) => publicShowcase || !user || allows(getNavigationAuthorizationRequirement(item.id)))
      .map((item) => ({
        ...item,
        icon: ICON_COMPONENTS[item.icon] ?? MessageSquare,
      })),
    [allows, appShell.navigation, publicShowcase, user],
  )
  const settingsSections = useMemo(
    () => appShell.settingsSections.filter((section) => (
      publicShowcase || !user || allows(getSettingsSectionAuthorizationRequirement(section.id))
    )),
    [allows, appShell.settingsSections, publicShowcase, user],
  )
  return { availableToolsInlineItems, navItems, settingsSections }
}

function useSidebarActions({ appShell, allows, publicShowcase, user }: {
  appShell: SidebarNavConfigArgs['appShell']
  allows: SidebarNavConfigArgs['allows']
  publicShowcase: boolean
  user: SidebarNavConfigArgs['user']
}) {
  const sidebarActions = useMemo(
    () => appShell.sidebarActions.filter((action) => (
      publicShowcase || !user || allows(getSidebarActionAuthorizationRequirement(action.actionKey))
    )),
    [allows, appShell.sidebarActions, publicShowcase, user],
  )
  const primaryNavActionByItemId = useMemo(() => {
    const entries = sidebarActions
      .filter((action) => action.primaryNavAction && action.navigationItemId)
      .map((action) => [action.navigationItemId!, action] as const)
    return new Map(entries)
  }, [sidebarActions])
  return { sidebarActions, primaryNavActionByItemId }
}

function useSidebarNavInteractions(args: {
  routeState: ReturnType<typeof resolveSidebarRouteState>
  pendingNav: { href: string; fromPath: string } | null
  pendingSecondaryNav: { id: string; fromRouteKey: string } | null
  currentRouteKey: string
  pathname: string
  resolveWorkspaceSurface: (path: string) => ReturnType<NonNullable<AppSidebarWorkspaceAdapter['resolveSurface']>>
  isGuestConfirmed: boolean
  requireAuth: ReturnType<typeof useGuestGate>['requireAuth']
  publicShowcase: boolean
  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string) => string
  primaryNavActionByItemId: ReturnType<typeof useSidebarActions>['primaryNavActionByItemId']
  runSidebarAction: ReturnType<typeof useAppSidebarActions>['runSidebarAction']
  router: ReturnType<typeof useRouter>
  setPendingNav: Dispatch<SetStateAction<{ href: string; fromPath: string } | null>>
  setPendingSecondaryNav: Dispatch<SetStateAction<{ id: string; fromRouteKey: string } | null>>
  sidebarCollapsed: boolean
  setSidebarCollapsed: (next: boolean) => void
  automationsEnabled: boolean
  setMobileView: Dispatch<SetStateAction<'nav' | 'panel'>>
  closeMobileDrawer: () => void
}) {
  const {
    routeState,
    pendingNav,
    pendingSecondaryNav,
    currentRouteKey,
    pathname,
    resolveWorkspaceSurface,
    isGuestConfirmed,
    requireAuth,
    publicShowcase,
    activeWorkspaceId,
    buildWorkspaceHref,
    primaryNavActionByItemId,
    runSidebarAction,
    router,
    setPendingNav,
    setPendingSecondaryNav,
    sidebarCollapsed,
    setSidebarCollapsed,
    automationsEnabled,
    setMobileView,
    closeMobileDrawer,
  } = args

  const effectivePendingHref =
    pendingNav && pathname === pendingNav.fromPath ? pendingNav.href : null
  const effectivePendingSecondaryNavId = pendingSecondaryNav?.fromRouteKey === currentRouteKey
    ? pendingSecondaryNav.id
    : null

  const isNavItemActive = (item: SidebarNavItem) => isSidebarNavItemActive(item, {
    resolveWorkspaceSurface,
    effectivePendingHref,
    filesSectionOpen: routeState.filesSectionOpen,
    canonicalWorkspaceRoute: routeState.canonicalWorkspaceRoute,
    workspaceSurface: routeState.workspaceSurface,
    pathname,
  })
  const navItemDestination = (href: string) => resolveNavItemDestination(href, {
    publicShowcase,
    activeWorkspaceId,
    buildWorkspaceHref,
  })
  const onSelectNavItem = (item: SidebarNavItem) => selectSidebarNavItem(item, {
    isGuestConfirmed,
    publicShowcase,
    requireAuth,
    primaryNavActionByItemId,
    runSidebarAction,
    isActive: isNavItemActive,
    destination: navItemDestination,
    pathname,
    router,
    setPendingNav,
    panelKind: routeState.panelKind,
    sidebarCollapsed,
    setSidebarCollapsed,
  })
  const onSelectMobileNavItem = (item: SidebarNavItem) => selectMobileNavItem(item, {
    isGuestConfirmed,
    publicShowcase,
    requireAuth,
    primaryNavActionByItemId,
    runSidebarAction,
    isActive: isNavItemActive,
    destination: navItemDestination,
    pathname,
    router,
    setPendingNav,
    automationsEnabled,
    openPanel: () => setMobileView('panel'),
    closeDrawer: closeMobileDrawer,
  })
  const onSelectMobileAdmin = () => selectMobileAdmin({
    adminOpen: routeState.adminOpen,
    pathname,
    router,
    setPendingNav,
    closeMobileDrawer,
  })
  const beginSecondaryNavigation = (id: string) => {
    setPendingSecondaryNav({ id, fromRouteKey: currentRouteKey })
  }

  return {
    effectivePendingHref,
    effectivePendingSecondaryNavId,
    isNavItemActive,
    navItemDestination,
    onSelectNavItem,
    onSelectMobileNavItem,
    onSelectMobileAdmin,
    beginSecondaryNavigation,
  }
}

function useSidebarPanelChrome(args: {
  routeState: ReturnType<typeof resolveSidebarRouteState>
  pathname: string
  brandConfig: ReturnType<typeof resolveOverlayAppShellConfig>['brand']
  sidebarActions: ReturnType<typeof useSidebarActions>['sidebarActions']
  publicShowcase: boolean
  requireAuth: ReturnType<typeof useGuestGate>['requireAuth']
  runSidebarAction: ReturnType<typeof useAppSidebarActions>['runSidebarAction']
  effectivePendingHref: string | null
  effectivePendingSecondaryNavId: string | null
  beginSecondaryNavigation: (id: string) => void
  isNavItemActive: (item: SidebarNavItem) => boolean
  navItemDestination: (href: string) => string
  onSelectNavItem: (item: SidebarNavItem) => void
  user: ReturnType<typeof useAuth>['user']
  activeWorkspaceId: string | null
  collaborationUnread: ReturnType<typeof useCollaborationUnread>
  totalUnread: number
  router: ReturnType<typeof useRouter>
  buildWorkspaceHref: (workspaceId: string, href: string) => string
  currentSearchParams: URLSearchParams
  availableToolsInlineItems: ReturnType<typeof useSidebarNavConfig>['availableToolsInlineItems']
  settingsSections: ReturnType<typeof useSidebarNavConfig>['settingsSections']
  closeMobileDrawer: () => void
  navItems: SidebarNavItem[]
  primaryNavActionByItemId: ReturnType<typeof useSidebarActions>['primaryNavActionByItemId']
  isGuestConfirmed: boolean
  cumulativeChatUnread: number
  automationsEnabled: boolean
  showAdminNavigation: boolean
  setPendingNav: Dispatch<SetStateAction<{ href: string; fromPath: string } | null>>
}) {
  const {
    routeState,
    pathname,
    brandConfig,
    sidebarActions,
    publicShowcase,
    requireAuth,
    runSidebarAction,
    effectivePendingHref,
    effectivePendingSecondaryNavId,
    beginSecondaryNavigation,
    isNavItemActive,
    navItemDestination,
    onSelectNavItem,
    user,
    activeWorkspaceId,
    collaborationUnread,
    totalUnread,
    router,
    buildWorkspaceHref,
    currentSearchParams,
    availableToolsInlineItems,
    settingsSections,
    closeMobileDrawer,
    navItems,
    primaryNavActionByItemId,
    isGuestConfirmed,
    cumulativeChatUnread,
    automationsEnabled,
    showAdminNavigation,
    setPendingNav,
  } = args

  const contextualAction = resolveSidebarActionForPath(
    // Activity and Archived live under the Chats secondary panel, so keep New chat + search.
    routeState.activityOpen || routeState.archivedOpen || routeState.chatsView === 'activity' || routeState.chatsView === 'archived'
      ? '/app/chat'
      : routeState.canonicalWorkspaceRoute
        ? `/app/${routeState.workspaceSurface}`
        : pathname,
    sidebarActions,
  )
  const panelTitle = routeState.panelKind
    ? PANEL_KIND_TITLES[routeState.panelKind]
    : brandConfig.shortName ?? brandConfig.name

  const resourceAction = resolveResourceAction({
    chatOpen: routeState.chatOpen,
    chatsView: routeState.chatsView,
    contextualAction,
    panelKind: routeState.panelKind,
    publicShowcase,
    requireAuth,
    runSidebarAction,
  })
  const contextualSearchCategory = toMentionCategory(contextualAction?.searchCategory)
  const {
    globalSearchOpen,
    globalSearchInitialCategory,
    openGlobalSearch,
    closeGlobalSearch,
  } = useGlobalSearch()

  const shouldLoadCollaborationUnread = !publicShowcase && Boolean(user) && Boolean(activeWorkspaceId)

  const panelNav = resolveSecondaryPanelNav({
    panelKind: routeState.panelKind,
    publicShowcase,
    routeState,
    effectivePendingSecondaryNavId,
    totalUnread,
    collaborationUnread,
    shouldLoadCollaborationUnread,
    router,
    activeWorkspaceId,
    buildWorkspaceHref,
    currentSearchParams,
    toolsItems: availableToolsInlineItems,
    settingsSections,
    closeMobileDrawer,
    beginSecondaryNavigation,
  })

  const panelAction = routeState.hasResourcePanel ? resourceAction : null
  const panelSearch = routeState.hasResourcePanel && contextualSearchCategory
    ? {
      title: contextualSearchCategory === 'chat' ? 'Search chats (⌘K)' : 'Search files (⌘K)',
      onClick: () => publicShowcase ? requireAuth('history') : openGlobalSearch(contextualSearchCategory),
    }
    : null

  const showcasePrimaryLinks = resolveShowcasePrimaryLinks(publicShowcase)
  const railItems = buildPrimaryRailItems({
    showAdminNavigation,
    adminOpen: routeState.adminOpen,
    effectivePendingHref,
    navItems,
    primaryNavActionByItemId,
    isGuestConfirmed,
    publicShowcase,
    cumulativeChatUnread,
    settingsPathActive: routeState.settingsPathActive,
    pathname,
    router,
    setPendingNav,
    navItemDestination,
    navItemActive: isNavItemActive,
    onSelectItem: onSelectNavItem,
  })
  const railFooterItems = buildShowcaseRailFooterItems(showcasePrimaryLinks, router)
  const mobileNavItems = resolveMobileNavItems(navItems, {
    effectivePendingHref,
    cumulativeChatUnread,
    automationsEnabled,
    isActive: isNavItemActive,
  })

  return {
    contextualAction,
    panelTitle,
    globalSearchOpen,
    globalSearchInitialCategory,
    closeGlobalSearch,
    shouldLoadCollaborationUnread,
    panelNav,
    panelAction,
    panelSearch,
    showcasePrimaryLinks,
    railItems,
    railFooterItems,
    mobileNavItems,
  }
}

function useSidebarDerivedPanels(args: {
  pathname: string
  currentSearchParams: URLSearchParams
  resolveWorkspaceSurface: (path: string) => ReturnType<NonNullable<AppSidebarWorkspaceAdapter['resolveSurface']>>
  automationsEnabled: boolean
  can: ReturnType<typeof useAuthorization>['can']
  publicShowcase: boolean
  user: ReturnType<typeof useAuth>['user']
  isGuestConfirmed: boolean
  requireAuth: ReturnType<typeof useGuestGate>['requireAuth']
  billingEnabled: boolean
  authLoading: boolean
  authUserId: string | null
  activeWorkspaceId: string | null
  accountMenuOpen: boolean
  mobileAccountOpen: boolean
  collaborationNotifications: NonNullable<AppSidebarProps['collaborationNotifications']>
  totalUnread: number
  brandConfig: ReturnType<typeof resolveOverlayAppShellConfig>['brand']
  navItems: SidebarNavItem[]
  settingsSections: ReturnType<typeof useSidebarNavConfig>['settingsSections']
  availableToolsInlineItems: ReturnType<typeof useSidebarNavConfig>['availableToolsInlineItems']
  sidebarActions: ReturnType<typeof useSidebarActions>['sidebarActions']
  primaryNavActionByItemId: ReturnType<typeof useSidebarActions>['primaryNavActionByItemId']
  router: ReturnType<typeof useRouter>
  buildWorkspaceHref: (workspaceId: string, href: string) => string
  pendingNav: { href: string; fromPath: string } | null
  pendingSecondaryNav: { id: string; fromRouteKey: string } | null
  currentRouteKey: string
  sidebarCollapsed: boolean
  setSidebarCollapsed: (next: boolean) => void
  setPendingNav: Dispatch<SetStateAction<{ href: string; fromPath: string } | null>>
  setPendingSecondaryNav: Dispatch<SetStateAction<{ id: string; fromRouteKey: string } | null>>
  setMobileMenuOpen: Dispatch<SetStateAction<boolean>>
  setMobileView: Dispatch<SetStateAction<'nav' | 'panel'>>
  setMobileAccountOpen: Dispatch<SetStateAction<boolean>>
  setAccountMenuOpen: Dispatch<SetStateAction<boolean>>
  setChatPanelRefreshKey: Dispatch<SetStateAction<number>>
  mobileAccountRef: RefObject<HTMLDivElement | null>
  mobileMenuOpen: boolean
}) {
  const {
    pathname,
    currentSearchParams,
    resolveWorkspaceSurface,
    automationsEnabled,
    can,
    publicShowcase,
    user,
    isGuestConfirmed,
    requireAuth,
    billingEnabled,
    authLoading,
    authUserId,
    activeWorkspaceId,
    accountMenuOpen,
    mobileAccountOpen,
    collaborationNotifications,
    totalUnread,
    brandConfig,
    navItems,
    settingsSections,
    availableToolsInlineItems,
    sidebarActions,
    primaryNavActionByItemId,
    router,
    buildWorkspaceHref,
    pendingNav,
    pendingSecondaryNav,
    currentRouteKey,
    sidebarCollapsed,
    setSidebarCollapsed,
    setPendingNav,
    setPendingSecondaryNav,
    setMobileMenuOpen,
    setMobileView,
    setMobileAccountOpen,
    setAccountMenuOpen,
    setChatPanelRefreshKey,
    mobileAccountRef,
    mobileMenuOpen,
  } = args
  const routeState = resolveSidebarRouteState({
    pathname,
    searchParams: currentSearchParams,
    resolveWorkspaceSurface,
    automationsEnabled,
  })
  const showAdminNavigation = can('administration.access') && !publicShowcase && Boolean(user)

  const closeMobileDrawer = () => {
    setMobileMenuOpen(false)
    setMobileView('nav')
  }
  const closeOverlayMenus = () => {
    setMobileMenuOpen(false)
    setMobileView('nav')
    setMobileAccountOpen(false)
    setAccountMenuOpen(false)
  }

  const hideTemporaryChatChrome = useTemporaryChatUiHidden({
    pathname,
    resolveWorkspaceSurface,
    onHide: closeOverlayMenus,
  })
  const collaborationUnread = useCollaborationUnread({
    publicShowcase,
    user,
    activeWorkspaceId,
    collaborationNotifications,
  })
  useUnreadChatRedirect({
    chatViewParam: routeState.chatViewParam,
    activeWorkspaceId,
    buildWorkspaceHref,
  })
  const entitlements = useSidebarEntitlements({
    billingEnabled,
    authLoading,
    authUserId,
    activeWorkspaceId,
    accountMenuOpen,
    mobileAccountOpen,
    filesSectionOpen: routeState.filesSectionOpen,
  })
  const sidebarIsFreeTier = (() => {
    if (!billingEnabled || !entitlements) return false
    const planKind = entitlements.planKind ?? (entitlements.tier === 'free' ? 'free' : 'paid')
    const isPaidSubscription = planKind === 'paid'
    const budgetRemainingCents =
      entitlements.budgetRemainingCents ??
      Math.max(
        0,
        (entitlements.budgetTotalCents ?? Math.max(0, Math.round((entitlements.creditsTotal ?? 0) * 100))) -
          (entitlements.budgetUsedCents ?? Math.max(0, Math.round((entitlements.creditsUsed ?? 0) * 100))),
      )
    const isBudgetExhaustedPaid = isPaidSubscription && budgetRemainingCents <= 0
    return !isPaidSubscription || isBudgetExhaustedPaid
  })()
  const {
    createChat,
    runSidebarAction,
  } = useAppSidebarActions({
    user,
    pathname,
    isFreeTier: sidebarIsFreeTier,
    requireAuth,
    onCloseMobileMenu: closeMobileDrawer,
    onChatCreated: () => setChatPanelRefreshKey((value: number) => value + 1),
  })

  useSidebarNavHotkeys({
    navItems,
    pathname,
    workspaceSurface: routeState.workspaceSurface,
    canonicalWorkspaceRoute: routeState.canonicalWorkspaceRoute,
    resolveWorkspaceSurface,
    settingsPathActive: routeState.settingsPathActive,
    isGuestConfirmed,
    publicShowcase,
    activeWorkspaceId,
    buildWorkspaceHref,
    requireAuth,
    setPendingNav,
    closeMobileDrawer,
  })
  useClickOutside(mobileAccountRef, mobileAccountOpen, setMobileAccountOpen)
  useBodyScrollLock(mobileMenuOpen)

  const {
    effectivePendingHref,
    effectivePendingSecondaryNavId,
    isNavItemActive,
    navItemDestination,
    onSelectNavItem,
    onSelectMobileNavItem,
    onSelectMobileAdmin,
    beginSecondaryNavigation,
  } = useSidebarNavInteractions({
    routeState,
    pendingNav,
    pendingSecondaryNav,
    currentRouteKey,
    pathname,
    resolveWorkspaceSurface,
    isGuestConfirmed,
    requireAuth,
    publicShowcase,
    activeWorkspaceId,
    buildWorkspaceHref,
    primaryNavActionByItemId,
    runSidebarAction,
    router,
    setPendingNav,
    setPendingSecondaryNav,
    sidebarCollapsed,
    setSidebarCollapsed,
    automationsEnabled,
    setMobileView,
    closeMobileDrawer,
  })
  const shouldLoadCollaborationUnread = !publicShowcase && Boolean(user) && Boolean(activeWorkspaceId)
  const cumulativeChatUnread = totalUnread + (shouldLoadCollaborationUnread ? collaborationUnread.total : 0)
  const {
    globalSearchOpen,
    globalSearchInitialCategory,
    closeGlobalSearch,
    panelTitle,
    panelNav,
    panelAction,
    panelSearch,
    showcasePrimaryLinks,
    railItems,
    railFooterItems,
    mobileNavItems,
  } = useSidebarPanelChrome({
    routeState,
    pathname,
    brandConfig,
    sidebarActions,
    publicShowcase,
    requireAuth,
    runSidebarAction,
    effectivePendingHref,
    effectivePendingSecondaryNavId,
    beginSecondaryNavigation,
    isNavItemActive,
    navItemDestination,
    onSelectNavItem,
    user,
    activeWorkspaceId,
    collaborationUnread,
    totalUnread,
    router,
    buildWorkspaceHref,
    currentSearchParams,
    availableToolsInlineItems,
    settingsSections,
    closeMobileDrawer,
    navItems,
    primaryNavActionByItemId,
    isGuestConfirmed,
    cumulativeChatUnread,
    automationsEnabled,
    showAdminNavigation,
    setPendingNav,
  })

  const closeAccountMenus = () => {
    setAccountMenuOpen(false)
    closeMobileDrawer()
    window.dispatchEvent(new CustomEvent('overlay:account-menu-action'))
  }

  return {
    routeState,
    panelTitle,
    showAdminNavigation,
    hideTemporaryChatChrome,
    entitlements,
    createChat,
    globalSearchOpen,
    globalSearchInitialCategory,
    closeGlobalSearch,
    effectivePendingSecondaryNavId,
    cumulativeChatUnread,
    onSelectNavItem,
    onSelectMobileNavItem,
    onSelectMobileAdmin,
    panelNav,
    panelAction,
    panelSearch,
    showcasePrimaryLinks,
    mobileNavItems,
    railItems,
    railFooterItems,
    closeMobileDrawer,
    closeAccountMenus,
  }
}

export function useAppSidebarState({
  collaborationNotifications = [],
  publicShowcase = false,
  workspace,
}: Pick<AppSidebarProps, 'collaborationNotifications' | 'publicShowcase' | 'workspace'>) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const routeSearchParams = useSearchParams()
  const currentSearchParams = useMemo(
    () => new URLSearchParams(routeSearchParams?.toString() ?? ''),
    [routeSearchParams],
  )
  const { capabilities } = useOverlayCapabilities()
  const { allows, can } = useAuthorization()
  const { requireAuth } = useGuestGate()
  const { user, isLoading: authLoading } = useAuth()
  const appShell = useMemo(
    () => resolveOverlayAppShellConfig(overlayAppConfig, { capabilities }),
    [capabilities],
  )
  const { availableToolsInlineItems, navItems, settingsSections } = useSidebarNavConfig({
    appShell,
    capabilities,
    allows,
    publicShowcase,
    user,
  })
  const brandConfig = appShell.brand
  const billingEnabled = capabilities.billing
  const authUserId = user?.id ?? null
  const isGuestConfirmed = !authLoading && !user
  const displayName = user ? (user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user.email) : 'Guest'
  const { totalUnread } = useAsyncSessions()
  const activeWorkspaceId = workspace?.activeWorkspaceId ?? null
  const resolveSurfaceAdapter = workspace?.resolveSurface
  const buildHrefAdapter = workspace?.buildHref
  const resolveWorkspaceSurface = useCallback(
    (path: string) => resolveSurfaceAdapter?.(path) ?? null,
    [resolveSurfaceAdapter],
  )
  const buildWorkspaceHref = useCallback(
    (workspaceId: string, href: string) => buildHrefAdapter?.(workspaceId, href) ?? href,
    [buildHrefAdapter],
  )

  const [pendingNav, setPendingNav] = useState<{ href: string; fromPath: string } | null>(null)
  const currentRouteKey = `${pathname}?${currentSearchParams.toString()}`
  const [pendingSecondaryNav, setPendingSecondaryNav] = useState<{ id: string; fromRouteKey: string } | null>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileView, setMobileView] = useState<'nav' | 'panel'>('nav')
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false)
  const storedSidebarCollapsed = useSyncExternalStore(
    subscribeToSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    () => false,
  )
  const [showcaseSidebarCollapsed, setShowcaseSidebarCollapsed] = useState(false)
  // Collapse now means "primary rail only": the contextual secondary panel is
  // hidden and the rail stays put.
  const sidebarCollapsed = publicShowcase ? showcaseSidebarCollapsed : storedSidebarCollapsed
  const setSidebarCollapsed = useCallback((next: boolean) => {
    if (publicShowcase) setShowcaseSidebarCollapsed(next)
    else setStoredSidebarCollapsed(next)
  }, [publicShowcase])
  const [chatPanelRefreshKey, setChatPanelRefreshKey] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const mobileAccountRef = useRef<HTMLDivElement>(null)
  const { sidebarActions, primaryNavActionByItemId } = useSidebarActions({
    appShell,
    allows,
    publicShowcase,
    user,
  })

  const {
    routeState,
    panelTitle,
    showAdminNavigation,
    hideTemporaryChatChrome,
    entitlements,
    createChat,
    globalSearchOpen,
    globalSearchInitialCategory,
    closeGlobalSearch,
    effectivePendingSecondaryNavId,
    cumulativeChatUnread,
    onSelectNavItem,
    onSelectMobileNavItem,
    onSelectMobileAdmin,
    panelNav,
    panelAction,
    panelSearch,
    showcasePrimaryLinks,
    mobileNavItems,
    railItems,
    railFooterItems,
    closeMobileDrawer,
    closeAccountMenus,
  } = useSidebarDerivedPanels({
    pathname,
    currentSearchParams,
    resolveWorkspaceSurface,
    automationsEnabled: capabilities.automations,
    can,
    publicShowcase,
    user,
    isGuestConfirmed,
    requireAuth,
    billingEnabled,
    authLoading,
    authUserId,
    activeWorkspaceId,
    accountMenuOpen,
    mobileAccountOpen,
    collaborationNotifications,
    totalUnread,
    brandConfig,
    navItems,
    settingsSections,
    availableToolsInlineItems,
    sidebarActions,
    primaryNavActionByItemId,
    router,
    buildWorkspaceHref,
    pendingNav,
    pendingSecondaryNav,
    currentRouteKey,
    sidebarCollapsed,
    setSidebarCollapsed,
    setPendingNav,
    setPendingSecondaryNav,
    setMobileMenuOpen,
    setMobileView,
    setMobileAccountOpen,
    setAccountMenuOpen,
    setChatPanelRefreshKey,
    mobileAccountRef,
    mobileMenuOpen,
  })

  return {
    pathname,
    router,
    capabilities,
    user,
    isGuestConfirmed,
    displayName,
    requireAuth,
    brandConfig,
    billingEnabled,
    entitlements,
    activeWorkspaceId,
    buildWorkspaceHref,
    routeState,
    panelTitle,
    accountMenuOpen,
    setAccountMenuOpen,
    mobileMenuOpen,
    setMobileMenuOpen,
    mobileView,
    setMobileView,
    mobileAccountOpen,
    setMobileAccountOpen,
    menuRef,
    mobileMenuRef,
    mobileAccountRef,
    sidebarCollapsed,
    setSidebarCollapsed,
    chatPanelRefreshKey,
    hideTemporaryChatChrome,
    createChat,
    globalSearchOpen,
    globalSearchInitialCategory,
    closeGlobalSearch,
    showAdminNavigation,
    effectivePendingSecondaryNavId,
    cumulativeChatUnread,
    onSelectNavItem,
    onSelectMobileNavItem,
    onSelectMobileAdmin,
    panelNav,
    panelAction,
    panelSearch,
    showcasePrimaryLinks,
    mobileNavItems,
    railItems,
    railFooterItems,
    closeMobileDrawer,
    closeAccountMenus,
    publicShowcase,
  }
}
