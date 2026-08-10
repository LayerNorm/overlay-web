'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore, Suspense } from 'react'
import {
  CreditCard, FileText, House, LayoutDashboard, MessageSquare, ScrollText, User,
  ChevronUp, Loader2, Menu, X, Settings, ChevronLeft, ChevronRight, ShieldCheck,
  Bot, Brain, Mail, Palette, UsersRound, Webhook,
} from 'lucide-react'
import {
  resolveOverlayAppShellConfig,
  resolveSidebarActionForPath,
} from '@overlay/app-core'
import { useAuth } from '@/contexts/AuthContext'
import { useGuestGate } from '@/components/providers/GuestGateProvider'
import { useAsyncSessions } from '@/components/providers/async-sessions-store'
import { SidebarListSkeleton } from '@overlay/ui/feedback'
import {
  SidebarShell,
  SidebarNav,
  SidebarSection,
  FloatingMenu,
} from '@overlay/ui/primitives'
import {
  AgentsInlinePanel,
  FilesInlinePanel,
  KnowledgeInlinePanel,
  ProjectsInlinePanel,
  chatsInlineItems,
  toolsInlineItems,
} from '@/components/layout/AppSidebarInlinePanels'
import { filesInlineItems, resolveFilesCategory } from '@/components/layout/FilesCategorySidebar'
import { useAppSidebarActions } from './sidebar/useAppSidebarActions'
import overlayAppConfig from '@/overlay.config'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useAuthorization } from '@/components/providers/AuthorizationProvider'
import {
  getNavigationAuthorizationRequirement,
  getSettingsSectionAuthorizationRequirement,
  getSidebarActionAuthorizationRequirement,
} from '@/shared/authorization/client-policy'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import dynamic from 'next/dynamic'
const GlobalSearchDialog = dynamic(() => import('./GlobalSearchDialog').then((mod) => ({ default: mod.GlobalSearchDialog })))
import type { MentionType } from '@/shared/knowledge/mention-types'
import { TEMPORARY_CHAT_UI_EVENT, type TemporaryChatUiEventDetail } from '@/shared/chat/temporary-chat-ui'
import {
  COLLABORATION_NOTIFICATIONS_CHANGED_EVENT,
  NEW_CHANNEL_EVENT,
  NEW_DIRECT_MESSAGE_EVENT,
} from '@/shared/chat/collaboration-events'
import { getLastChatForView } from '@/shared/chat/last-chat-by-view'
import {
  selectConversationForView,
  type CollaborationChatView,
} from '@/shared/chat/chat-view-navigation'
import type { CachedConversation } from '@/shared/chat/chat-list-cache'
import {
  getSidebarCollapsedSnapshot,
  setStoredSidebarCollapsed,
  subscribeToSidebarCollapsed,
} from './sidebar/sidebarCollapsedStore'
import { categorizeCollaborationUnreadNotifications } from '@/shared/chat/notification-badges'
import { SidebarAccountMenu } from './sidebar/SidebarAccountMenu'
import { ICON_COMPONENTS, toMentionCategory } from './sidebar/sidebarNavigation'
import type { SidebarEntitlements } from './sidebar/SidebarUsageMeters'
import {
  AppSidebarPrimaryRail,
  type PrimaryRailItem,
} from './sidebar/AppSidebarPrimaryRail'
import {
  AppSidebarSecondaryPanel,
  SecondaryPanelContent,
  type SecondaryPanelNav,
} from './sidebar/AppSidebarSecondaryPanel'
import type { AppSidebarProps } from './appSidebarTypes'
import { MARKETING_DOCS_URL } from '@/shared/marketing/marketing'
import { ROOT_APP_DESTINATION, ROOT_SHOWCASE_DESTINATION } from '@/shared/auth/root-entry'
import { NEW_AGENT_EVENT, NEW_KNOWLEDGE_BASE_EVENT } from '@/shared/workspace/sidebar-events'

export type {
  AppSidebarChatPanelContext,
  AppSidebarNavigateContext,
  AppSidebarProps,
  AppSidebarWorkspaceAdapter,
} from './appSidebarTypes'

type SecondaryPanelKind = 'chat' | 'files' | 'notes' | 'projects' | 'agents' | 'knowledge' | 'automations' | 'tools' | 'settings'

const PANEL_KIND_TITLES: Record<SecondaryPanelKind, string> = {
  chat: 'chats',
  files: 'files',
  notes: 'notes',
  projects: 'projects',
  agents: 'agents',
  knowledge: 'knowledge',
  automations: 'automations',
  tools: 'extensions',
  settings: 'settings',
}

const SETTINGS_SECTION_ICONS: Record<string, typeof Settings> = {
  general: Settings,
  account: User,
  customization: Palette,
  memories: Brain,
  models: Bot,
  webhooks: Webhook,
  contact: Mail,
  workspace: UsersRound,
}

const RESOURCE_PANEL_KINDS: ReadonlySet<SecondaryPanelKind> = new Set([
  'chat',
  'files',
  'notes',
  'projects',
  'agents',
  'knowledge',
  'automations',
])

export default function AppSidebar({
  publicShowcase = false,
  renderChatPanel,
  renderAutomationsPanel,
  renderFilesPanel,
  renderProjectsPanel,
  renderAgentsPanel,
  renderKnowledgePanel,
  workspace,
}: AppSidebarProps) {
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
  const availableToolsInlineItems = useMemo(
    () => toolsInlineItems.filter((item) => {
      if (item.id === 'skills') return capabilities.skills && allows({ all: ['skills.use'] })
      if (item.id === 'mcps') return capabilities.mcpServers && allows({ all: ['mcp.use'] })
      if (item.id === 'connectors') return allows({ all: ['integrations.use'] })
      return true
    }),
    [allows, capabilities.mcpServers, capabilities.skills],
  )
  const navItems = useMemo(
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
  const [entitlements, setEntitlements] = useState<SidebarEntitlements | null>(null)
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false)
  const [temporaryChatUiHidden, setTemporaryChatUiHidden] = useState(false)
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
  const [collaborationUnread, setCollaborationUnread] = useState({ dms: 0, channels: 0, total: 0 })
  const [projectsPanelRefreshKey, setProjectsPanelRefreshKey] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const mobileAccountRef = useRef<HTMLDivElement>(null)
  const chatViewNavigationVersionRef = useRef(0)
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
  const sidebarIsFreeTier = useMemo(() => {
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
  }, [billingEnabled, entitlements])
  const {
    createChat,
    runSidebarAction,
  } = useAppSidebarActions({
    user,
    pathname,
    isFreeTier: sidebarIsFreeTier,
    requireAuth,
    onCloseMobileMenu: () => {
      setMobileMenuOpen(false)
      setMobileView('nav')
    },
    onChatCreated: () => setChatPanelRefreshKey((value) => value + 1),
    onProjectCreated: () => setProjectsPanelRefreshKey((value) => value + 1),
  })

  useEffect(() => {
    function onProjectsChanged() {
      setProjectsPanelRefreshKey((v) => v + 1)
    }
    window.addEventListener('overlay:projects-changed', onProjectsChanged)
    return () => window.removeEventListener('overlay:projects-changed', onProjectsChanged)
  }, [])

  useEffect(() => {
    function onTemporaryChatUi(event: Event) {
      const active = Boolean((event as CustomEvent<TemporaryChatUiEventDetail>).detail?.active)
      setTemporaryChatUiHidden(active)
      if (active) {
        setMobileMenuOpen(false)
        setMobileView('nav')
        setMobileAccountOpen(false)
        setAccountMenuOpen(false)
      }
    }

    window.addEventListener(TEMPORARY_CHAT_UI_EVENT, onTemporaryChatUi)
    return () => window.removeEventListener(TEMPORARY_CHAT_UI_EVENT, onTemporaryChatUi)
  }, [])

  const effectivePendingHref =
    pendingNav && pathname === pendingNav.fromPath ? pendingNav.href : null
  const effectivePendingSecondaryNavId = pendingSecondaryNav?.fromRouteKey === currentRouteKey
    ? pendingSecondaryNav.id
    : null
  const hideTemporaryChatChrome = temporaryChatUiHidden && (
    pathname.startsWith('/app/chat') ||
    (pathname.startsWith('/app/w/') && resolveWorkspaceSurface(pathname) === 'chat')
  )
  const workspaceSurface = resolveWorkspaceSurface(pathname)
  const canonicalWorkspaceRoute = pathname.startsWith('/app/w/')
  const projectsOpen = pathname.startsWith('/app/projects') || (canonicalWorkspaceRoute && workspaceSurface === 'projects')
  const notesOpen = pathname.startsWith('/app/notes') || (canonicalWorkspaceRoute && workspaceSurface === 'notes')
  const filesOpen = pathname.startsWith('/app/files') || (canonicalWorkspaceRoute && workspaceSurface === 'files')
  const filesSectionOpen = filesOpen || notesOpen
  const agentsOpen = pathname.startsWith('/app/agents') || (canonicalWorkspaceRoute && workspaceSurface === 'agents')
  const knowledgeOpen = pathname.startsWith('/app/knowledge') || (canonicalWorkspaceRoute && workspaceSurface === 'knowledge')
  // Activity is its own page but stays under the Chats secondary panel, so the
  // subnavigation it was selected from remains visible beside it.
  const activityOpen = pathname.startsWith('/app/activity') || (canonicalWorkspaceRoute && workspaceSurface === 'activity')
  const chatOpen = activityOpen || pathname.startsWith('/app/chat') || (canonicalWorkspaceRoute && workspaceSurface === 'chat')
  const adminOpen = pathname.startsWith('/app/admin') || (canonicalWorkspaceRoute && workspaceSurface === 'admin')
  const showAdminNavigation = can('administration.access') && !publicShowcase && Boolean(user)
  const automationsOpen = pathname.startsWith('/app/automations') || (canonicalWorkspaceRoute && workspaceSurface === 'automations')
  const automationsSectionOpen = automationsOpen && capabilities.automations
  const toolsOpen = pathname.startsWith('/app/tools') || (canonicalWorkspaceRoute && workspaceSurface === 'tools')
  const settingsPathActive = pathname.startsWith('/app/settings') || (canonicalWorkspaceRoute && workspaceSurface === 'settings')
  const settingsSection = currentSearchParams.get('section') ?? 'general'
  const toolsView = (() => {
    const current = currentSearchParams.get('view')
    if (current === 'skills') return 'skills'
    if (current === 'mcps') return 'mcps'
    if (current === 'apps') return 'apps'
    if (current === 'installed') return 'installed'
    return 'connectors'
  })()
  const filesView = resolveFilesCategory(currentSearchParams.get('view'))
  const chatViewParam = currentSearchParams.get('view')
  const chatsView = (() => {
    if (activityOpen) return 'activity'
    if (chatViewParam === 'dms') return 'dms'
    if (chatViewParam === 'channels') return 'channels'
    if (chatViewParam === 'all') return 'all'
    return 'personal'
  })()
  const shouldLoadCollaborationUnread = !publicShowcase && Boolean(user) && Boolean(activeWorkspaceId)
  const cumulativeChatUnread = totalUnread + (shouldLoadCollaborationUnread ? collaborationUnread.total : 0)
  const chatUnreadBadges = {
    personal: totalUnread,
    dms: shouldLoadCollaborationUnread ? collaborationUnread.dms : 0,
    channels: shouldLoadCollaborationUnread ? collaborationUnread.channels : 0,
    activity: cumulativeChatUnread,
  }

  useEffect(() => {
    if (publicShowcase || !user || !activeWorkspaceId) {
      return
    }
    let cancelled = false
    const loadUnread = async () => {
      try {
        const result = await overlayAppClient.conversations.notifications({ unreadOnly: true, limit: 100 })
        const notifications = Array.isArray(result.notifications) ? result.notifications : []
        let conversations: CachedConversation[] = []
        if (notifications.length > 0) {
          try {
            const page = await overlayAppClient.conversations.getPage<CachedConversation>({ view: 'all', limit: 100 })
            conversations = page.data
          } catch {
            // Activity remains complete even when the conversation directory is briefly unavailable.
          }
        }
        if (!cancelled) setCollaborationUnread(categorizeCollaborationUnreadNotifications(notifications, conversations))
      } catch {
        // The primary chat navigation stays usable while notification state retries.
      }
    }
    const handleChanged = () => { void loadUnread() }
    void loadUnread()
    const timer = window.setInterval(handleChanged, 15_000)
    window.addEventListener(COLLABORATION_NOTIFICATIONS_CHANGED_EVENT, handleChanged)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener(COLLABORATION_NOTIFICATIONS_CHANGED_EVENT, handleChanged)
    }
  }, [activeWorkspaceId, publicShowcase, user])

  useEffect(() => {
    // Unread was folded into Activity; rewrite stale deep links.
    if (chatViewParam !== 'unread') return
    router.replace(activeWorkspaceId
      ? buildWorkspaceHref(activeWorkspaceId, '/app/activity')
      : '/app/activity')
  }, [activeWorkspaceId, buildWorkspaceHref, chatViewParam, router])

  const loadEntitlements = useCallback(async () => {
    if (!billingEnabled || authLoading || !authUserId) {
      setEntitlements(null)
      return
    }
    try {
      const res = await overlayAppClient.subscription.getResponse()
      if (res.ok) setEntitlements(await res.json())
    } catch {
      // ignore
    }
  }, [authLoading, authUserId, billingEnabled, setEntitlements])

  useEffect(() => {
    document.documentElement.toggleAttribute('data-temporary-chat-ui', hideTemporaryChatChrome)
    return () => document.documentElement.removeAttribute('data-temporary-chat-ui')
  }, [hideTemporaryChatChrome])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadEntitlements()
    }, 0)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [loadEntitlements])

  useEffect(() => {
    if (!accountMenuOpen && !mobileAccountOpen && !filesSectionOpen) return
    const intervalId = window.setInterval(() => { void loadEntitlements() }, 30_000)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [accountMenuOpen, mobileAccountOpen, filesSectionOpen, loadEntitlements])

  useEffect(() => {
    function onSubscriptionRefresh() {
      void loadEntitlements()
    }
    window.addEventListener('overlay:subscription-refresh', onSubscriptionRefresh)
    return () => window.removeEventListener('overlay:subscription-refresh', onSubscriptionRefresh)
  }, [loadEntitlements])

  useEffect(() => {
    function onNavShortcut(e: KeyboardEvent) {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.repeat) return
      const t = e.target
      if (t instanceof Node && (t as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) {
        return
      }
      if (e.code === 'Digit7') {
        e.preventDefault()
        if (settingsPathActive) return
        if (isGuestConfirmed) { requireAuth('settings'); return }
        setMobileMenuOpen(false)
        setMobileView('nav')
        setPendingNav({ href: '/app/settings', fromPath: pathname })
        router.push('/app/settings')
        return
      }
      const m = /^Digit([1-6])$/.exec(e.code)
      if (!m) return
      const idx = parseInt(m[1]!, 10) - 1
      const item = navItems[idx]
      if (!item || item.disabled || !item.href) return
      e.preventDefault()
      if (
        pathname.startsWith(item.href) ||
        (canonicalWorkspaceRoute && workspaceSurface === resolveWorkspaceSurface(item.href))
      ) return
      if (isGuestConfirmed && !publicShowcase && item.href !== '/app/chat') { requireAuth('nav'); return }
      const workspaceHref = activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, item.href)
        : item.href
      setPendingNav({ href: workspaceHref, fromPath: pathname })
      router.push(publicShowcase
        ? `${item.href}?${new URLSearchParams({
            showcase: '1',
            ...(item.href === '/app/chat' ? { id: 'showcase-welcome' } : {}),
          }).toString()}`
        : workspaceHref)
    }
    window.addEventListener('keydown', onNavShortcut, true)
    return () => window.removeEventListener('keydown', onNavShortcut, true)
  }, [
    activeWorkspaceId,
    buildWorkspaceHref,
    canonicalWorkspaceRoute,
    isGuestConfirmed,
    navItems,
    pathname,
    publicShowcase,
    requireAuth,
    router,
    settingsPathActive,
    workspaceSurface,
    resolveWorkspaceSurface,
  ])

  useEffect(() => {
    if (!mobileAccountOpen) return
    function handleClick(e: MouseEvent) {
      if (mobileAccountRef.current && !mobileAccountRef.current.contains(e.target as Node)) {
        setMobileAccountOpen(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [mobileAccountOpen])

  useEffect(() => {
    if (!mobileMenuOpen) return
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [mobileMenuOpen])

  async function handleSignOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' })
    window.location.href = '/'
  }

  function closeMobileDrawer() {
    setMobileMenuOpen(false)
    setMobileView('nav')
  }

  const contextualAction = resolveSidebarActionForPath(
    // Activity lives under the Chats secondary panel, so keep New chat + search.
    activityOpen || chatsView === 'activity'
      ? '/app/chat'
      : canonicalWorkspaceRoute
        ? `/app/${workspaceSurface}`
        : pathname,
    sidebarActions,
  )

  const panelKind: SecondaryPanelKind | null = chatOpen
    ? 'chat'
    : filesOpen
      ? 'files'
      : notesOpen
        ? 'notes'
        : projectsOpen
          ? 'projects'
            : agentsOpen
              ? 'agents'
              : knowledgeOpen
                ? 'knowledge'
                : automationsSectionOpen
                  ? 'automations'
                  : toolsOpen
                    ? 'tools'
                    : settingsPathActive
                      ? 'settings'
                      : null
  const hasResourcePanel = panelKind != null && RESOURCE_PANEL_KINDS.has(panelKind)
  const showSecondaryPanel = panelKind != null
  const panelTitle = panelKind
    ? PANEL_KIND_TITLES[panelKind]
    : brandConfig.shortName ?? brandConfig.name

  function navItemActive(item: (typeof navItems)[number]): boolean {
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

  function navItemDestination(href: string): string {
    return publicShowcase
      ? `${href}?${new URLSearchParams({
          showcase: '1',
          ...(href === '/app/chat' ? { id: 'showcase-welcome' } : {}),
        }).toString()}`
      : activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, href)
        : href
  }

  function panelKindForNavItem(item: (typeof navItems)[number]): SecondaryPanelKind | null {
    switch (item.href) {
      case '/app/chat':
        return 'chat'
      case '/app/files':
        return 'files'
      case '/app/projects':
        return 'projects'
      case '/app/agents':
        return 'agents'
      case '/app/knowledge':
        return 'knowledge'
      case '/app/automations':
        return capabilities.automations ? 'automations' : null
      case '/app/tools':
        return 'tools'
      default:
        return null
    }
  }

  function gateNavItem(item: (typeof navItems)[number]): 'action' | 'gated' | 'ok' {
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

  function selectNavItem(item: (typeof navItems)[number]) {
    if (gateNavItem(item) !== 'ok' || !item.href) return
    const active = navItemActive(item)
    if (active) {
      // Clicking the current section re-opens its panel when it is hidden.
      if (panelKind && sidebarCollapsed) setSidebarCollapsed(false)
      return
    }
    const destination = navItemDestination(item.href)
    setPendingNav({ href: destination, fromPath: pathname })
    router.push(destination)
  }

  function beginSecondaryNavigation(id: string) {
    setPendingSecondaryNav({ id, fromRouteKey: currentRouteKey })
  }

  function handleMobileNavSelect(item: (typeof navItems)[number]) {
    if (gateNavItem(item) !== 'ok' || !item.href) return
    const active = navItemActive(item)
    if (!active) {
      const destination = navItemDestination(item.href)
      setPendingNav({ href: destination, fromPath: pathname })
      router.push(destination)
    }
    // Two-step drawer: destinations with a contextual panel drill into it;
    // everything else navigates and closes.
    if (panelKindForNavItem(item)) setMobileView('panel')
    else closeMobileDrawer()
  }

  const resourceAction = chatOpen && chatsView === 'dms'
    ? {
      label: 'New message',
      onClick: () => publicShowcase
        ? requireAuth('nav')
        : window.dispatchEvent(new CustomEvent(NEW_DIRECT_MESSAGE_EVENT)),
    }
    : chatOpen && chatsView === 'channels'
      ? {
        label: 'New channel',
        onClick: () => publicShowcase
          ? requireAuth('nav')
          : window.dispatchEvent(new CustomEvent(NEW_CHANNEL_EVENT)),
      }
      : contextualAction
        ? {
          label: contextualAction.label,
          onClick: () => publicShowcase ? requireAuth('nav') : void runSidebarAction(contextualAction),
        }
        : panelKind === 'agents'
          ? {
            label: 'New agent',
            onClick: () => window.dispatchEvent(new CustomEvent(NEW_AGENT_EVENT)),
          }
          : panelKind === 'knowledge'
            ? {
              label: 'New knowledge base',
              onClick: () => window.dispatchEvent(new CustomEvent(NEW_KNOWLEDGE_BASE_EVENT)),
            }
            : null
  const contextualSearchCategory = toMentionCategory(contextualAction?.searchCategory)

  // Global Cmd/Ctrl+K command palette. The same dialog is reused by the per-section
  // search buttons in the sidebar; passing `globalSearchInitialCategory` opens it
  // pre-filtered to the current section (chats, files, …).
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchInitialCategory, setGlobalSearchInitialCategory] = useState<MentionType | null>(null)
  // Not wrapped in useCallback: this is only ever an inline JSX handler, never a
  // hook dependency, and hand-memoizing it makes React Compiler bail out of the
  // whole component ("existing memoization could not be preserved").
  const openGlobalSearch = (category: MentionType | null) => {
    setGlobalSearchInitialCategory(category)
    setGlobalSearchOpen(true)
  }
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey
      if (isMeta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setGlobalSearchInitialCategory(null)
        setGlobalSearchOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const panelNav: SecondaryPanelNav | undefined = (() => {
    if (panelKind === 'chat') {
      const chatItems = (publicShowcase
        ? chatsInlineItems.filter((item) => item.id !== 'activity')
        : chatsInlineItems).map((item) => ({ ...item, badgeCount: chatUnreadBadges[item.id] }))
      return {
        items: chatItems,
        activeId: chatsView,
        pendingId: effectivePendingSecondaryNavId,
        onSelect: async (next) => {
          closeMobileDrawer()
          if (next === chatsView) return
          beginSecondaryNavigation(next)
          if (next === 'activity') {
            router.push(activeWorkspaceId
              ? buildWorkspaceHref(activeWorkspaceId, '/app/activity')
              : '/app/activity')
            return
          }
          const baseHref = activeWorkspaceId
            ? buildWorkspaceHref(activeWorkspaceId, '/app/chat')
            : '/app/chat'
          const navigationVersion = ++chatViewNavigationVersionRef.current
          let conversationId: string | null = null
          if (next === 'dms' || next === 'channels') {
            try {
              const page = await overlayAppClient.conversations.getPage<CachedConversation>({
                limit: 24,
                view: next as CollaborationChatView,
              })
              if (navigationVersion !== chatViewNavigationVersionRef.current) return
              conversationId = selectConversationForView(
                page.data,
                getLastChatForView(activeWorkspaceId, next),
              )?._id ?? null
            } catch {
              // Stay in the selected subview with its empty state. Reusing an
              // unvalidated id here can mix a DM and channel after a failed fetch.
            }
          }
          router.push(`${baseHref}?${new URLSearchParams({
            ...(publicShowcase ? { showcase: '1' } : {}),
            view: next,
            ...(conversationId ? { id: conversationId } : {}),
          }).toString()}`)
        },
      }
    }
    if (panelKind === 'files' || panelKind === 'notes') {
      return {
        items: filesInlineItems,
        activeId: filesView,
        pendingId: effectivePendingSecondaryNavId,
        onSelect: (next) => {
          closeMobileDrawer()
          if (next === filesView) return
          beginSecondaryNavigation(next)
          const params = new URLSearchParams(currentSearchParams.toString())
          if (publicShowcase) params.set('showcase', '1')
          if (next === 'all') params.delete('view')
          else params.set('view', next)
          params.delete('file')
          params.delete('folder')
          const query = params.toString()
          router.push(query ? `${pathname}?${query}` : pathname)
        },
      }
    }
    if (panelKind === 'tools') {
      return {
        items: availableToolsInlineItems,
        activeId: toolsView,
        pendingId: effectivePendingSecondaryNavId,
        onSelect: (next) => {
          closeMobileDrawer()
          if (next === toolsView) return
          beginSecondaryNavigation(next)
          router.push(`/app/tools?${new URLSearchParams({
            ...(publicShowcase ? { showcase: '1' } : {}),
            view: next,
          }).toString()}`)
        },
      }
    }
    if (panelKind === 'settings') {
      return {
        items: settingsSections.map(({ id, label, href: sectionHref }) => ({
          id,
          label,
          icon: SETTINGS_SECTION_ICONS[id] ?? Settings,
          href: sectionHref ?? `/app/settings?section=${id}`,
        })),
        activeId: settingsSection,
        pendingId: effectivePendingSecondaryNavId,
        onSelect: (next) => {
          if (next !== settingsSection) beginSecondaryNavigation(next)
          closeMobileDrawer()
        },
      }
    }
    return undefined
  })()

  const panelAction = hasResourcePanel ? resourceAction : null
  const panelSearch = hasResourcePanel && contextualSearchCategory
    ? {
      title: contextualSearchCategory === 'chat' ? 'Search chats (⌘K)' : 'Search files (⌘K)',
      onClick: () => publicShowcase ? requireAuth('history') : openGlobalSearch(contextualSearchCategory),
    }
    : null

  const showcasePrimaryLinks = publicShowcase
    ? [
      { id: 'app', label: 'App', icon: LayoutDashboard, href: ROOT_APP_DESTINATION },
      { id: 'home', label: 'Home', icon: House, href: '/app/home?showcase=1' },
      { id: 'manifesto', label: 'Manifesto', icon: ScrollText, href: '/app/manifesto?showcase=1' },
      { id: 'pricing', label: 'Pricing', icon: CreditCard, href: '/app/pricing?showcase=1' },
      { id: 'docs', label: 'Docs', icon: FileText, href: MARKETING_DOCS_URL },
    ]
    : []

  const panelResourceList = hasResourcePanel ? (
    <Suspense fallback={<SidebarListSkeleton />}>
      {panelKind === 'chat' && renderChatPanel
        ? renderChatPanel({
            refreshKey: chatPanelRefreshKey,
            onNavigate: closeMobileDrawer,
          })
        : null}
      {panelKind === 'files' || panelKind === 'notes' ? (
        renderFilesPanel
          ? renderFilesPanel({ onNavigate: closeMobileDrawer })
          : <FilesInlinePanel searchQuery="" onNavigate={closeMobileDrawer} />
      ) : null}
      {panelKind === 'projects' ? (
        renderProjectsPanel
          ? renderProjectsPanel({ onNavigate: closeMobileDrawer })
          : <ProjectsInlinePanel refreshKey={projectsPanelRefreshKey} onNavigate={closeMobileDrawer} />
      ) : null}
      {panelKind === 'agents' ? (
        renderAgentsPanel
          ? renderAgentsPanel({ onNavigate: closeMobileDrawer })
          : <AgentsInlinePanel
            workspaceId={activeWorkspaceId}
            baseHref={activeWorkspaceId ? buildWorkspaceHref(activeWorkspaceId, '/app/agents') : undefined}
            onNavigate={closeMobileDrawer}
          />
      ) : null}
      {panelKind === 'knowledge' ? (
        renderKnowledgePanel
          ? renderKnowledgePanel({ onNavigate: closeMobileDrawer })
          : <KnowledgeInlinePanel
            baseHref={activeWorkspaceId ? buildWorkspaceHref(activeWorkspaceId, '/app/knowledge') : undefined}
            onNavigate={closeMobileDrawer}
          />
      ) : null}
      {panelKind === 'automations' && renderAutomationsPanel
        ? renderAutomationsPanel({ onNavigate: closeMobileDrawer })
        : null}
    </Suspense>
  ) : null

  const panelChildren = panelKind
    ? panelResourceList
    : null

  const brandLink = (
    <Link
      href={publicShowcase ? '/app/chat?showcase=1&id=showcase-welcome' : brandConfig.homeHref}
      className="flex min-w-0 items-center gap-2"
      onClick={closeMobileDrawer}
    >
      <Image src={brandConfig.logoSrc} alt={brandConfig.logoAlt ?? ''} width={10} height={10} className="shrink-0" />
      <span
        className="truncate text-xl font-medium tracking-tight"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {brandConfig.shortName ?? brandConfig.name}
      </span>
    </Link>
  )

  const railExpanded = !sidebarCollapsed
  const railBrand = sidebarCollapsed ? (
    // Collapsed, the rail is icon-only: the mark alone stands for the brand and
    // the wordmark returns with the expanded sidebar.
    <button
      type="button"
      onClick={() => setSidebarCollapsed(false)}
      className="group inline-flex h-10 w-full items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-subtle)]"
      aria-label="Expand sidebar"
      title="Expand sidebar"
    >
      <Image
        src={brandConfig.logoSrc}
        alt={brandConfig.logoAlt ?? ''}
        width={10}
        height={10}
        className="shrink-0 group-hover:hidden"
      />
      <ChevronRight size={16} className="hidden text-[var(--foreground)] group-hover:block" />
    </button>
  ) : (
    <>
      <Link
        href={publicShowcase ? '/app/chat?showcase=1&id=showcase-welcome' : brandConfig.homeHref}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1.5 transition-colors hover:bg-[var(--surface-subtle)]"
        aria-label="Home"
        title="Home"
      >
        <Image src={brandConfig.logoSrc} alt={brandConfig.logoAlt ?? ''} width={10} height={10} className="shrink-0" />
        <span
          className="truncate text-lg font-medium tracking-tight text-[var(--foreground)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {brandConfig.shortName ?? brandConfig.name}
        </span>
      </Link>
      <button
        type="button"
        onClick={() => {
          setAccountMenuOpen(false)
          setSidebarCollapsed(true)
        }}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        aria-label="Collapse sidebar"
        title="Collapse sidebar"
      >
        <ChevronLeft size={16} />
      </button>
    </>
  )

  /** Compact brand for the fixed mobile top bar (matches sidebar identity). */
  const mobileBrandLink = (
    <Link
      href={publicShowcase ? '/app/chat?showcase=1&id=showcase-welcome' : brandConfig.homeHref}
      className="flex min-w-0 max-w-[calc(100vw-8rem)] items-center gap-2"
      onClick={closeMobileDrawer}
    >
      <Image src={brandConfig.logoSrc} alt={brandConfig.logoAlt ?? ''} width={10} height={10} className="shrink-0" />
      <span
        className="truncate text-lg font-medium tracking-tight text-[var(--foreground)]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {brandConfig.shortName ?? brandConfig.name}
      </span>
    </Link>
  )

  const accountMenuContent = (
    <SidebarAccountMenu
      billingEnabled={billingEnabled}
      entitlements={entitlements}
      demoHref={!publicShowcase && user ? ROOT_SHOWCASE_DESTINATION : undefined}
      onAccountClick={() => {
        setAccountMenuOpen(false)
        closeMobileDrawer()
      }}
      onSignOut={() => {
        setAccountMenuOpen(false)
        void handleSignOut()
      }}
    />
  )

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
      onSelect: () => selectNavItem(item),
    })
  })

  const showcaseRailFooterItems: PrimaryRailItem[] = showcasePrimaryLinks.map((link) => ({
    id: link.id,
    label: link.label,
    icon: link.icon,
    title: link.label,
    onSelect: () => {
      if (/^https?:\/\//.test(link.href)) window.location.assign(link.href)
      else router.push(link.href)
    },
  }))

  const railFooterItems: PrimaryRailItem[] = showcaseRailFooterItems

  const desktopAccountMenu = !workspace ? (
    <FloatingMenu
      anchorRef={menuRef}
      open={accountMenuOpen}
      onOpenChange={setAccountMenuOpen}
      side="top"
      className="w-64"
    >
      {accountMenuContent}
    </FloatingMenu>
  ) : null

  const desktopAccountSlot = (
    <div ref={menuRef} className="relative">
      {!isGuestConfirmed && workspace ? (
        workspace.renderSwitcher?.({
          compact: !railExpanded,
          onNavigate: () => {
            setAccountMenuOpen(false)
          },
          placement: 'footer',
          userLabel: displayName,
          accountMenu: accountMenuContent,
        })
      ) : !isGuestConfirmed ? (
        <>
          {desktopAccountMenu}
          <button
            type="button"
            onClick={() => setAccountMenuOpen((value) => !value)}
            className={`flex h-9 w-full items-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${
              railExpanded ? 'gap-2.5 px-3' : 'justify-center'
            }`}
            aria-label="Account menu"
            aria-expanded={accountMenuOpen}
            title={displayName}
          >
            <User size={15} className="shrink-0" />
            {railExpanded ? <span className="min-w-0 flex-1 truncate text-left text-sm">{displayName}</span> : null}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => requireAuth('send')}
          className={`flex h-9 w-full items-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${
            railExpanded ? 'gap-2.5 px-3' : 'justify-center'
          }`}
          aria-label="Sign in"
          title="Sign in"
        >
          <User size={15} className="shrink-0" />
          {railExpanded ? <span className="min-w-0 flex-1 text-left text-sm">Sign in</span> : null}
        </button>
      )}
    </div>
  )

  const mobileNavStep = (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4">
        <div className="min-w-0 flex-1">
          {brandLink}
        </div>
        <button
          type="button"
          onClick={closeMobileDrawer}
          aria-label="Close app navigation"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <SidebarNav className="min-h-0 flex-1 overflow-y-auto">
          {showAdminNavigation ? (
            <button
              type="button"
              onClick={() => {
                if (adminOpen) {
                  closeMobileDrawer()
                  return
                }
                setPendingNav({ href: '/app/admin', fromPath: pathname })
                router.push('/app/admin')
                closeMobileDrawer()
              }}
              aria-label="Admin"
              aria-current={adminOpen ? 'page' : undefined}
              className={`group flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm transition-colors ${
                adminOpen
                  ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
              }`}
            >
              <ShieldCheck size={15} />
              <div className="min-w-0 flex-1 text-left">Admin</div>
            </button>
          ) : null}
          {navItems.map((item) => {
            const { href, label, icon: Icon, disabled } = item
            const active = navItemActive(item)
            const isPending = Boolean(href && effectivePendingHref === href)
            const unreadCount = href === '/app/chat' ? cumulativeChatUnread : 0
            const opensPanel = panelKindForNavItem(item) != null
            const rowClass = `group flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm transition-colors ${
              disabled
                ? 'cursor-not-allowed text-[var(--muted-light)]'
                : active
                  ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
            }`
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => handleMobileNavSelect(item)}
                title={disabled ? 'Coming soon' : label}
                aria-label={disabled ? `${label} (coming soon)` : label}
                aria-current={active ? 'page' : undefined}
                className={rowClass}
              >
                <Icon size={15} />
                <div className="min-w-0 flex-1 text-left">{label}</div>
                {isPending ? (
                  <Loader2 size={14} className="shrink-0 animate-spin text-[var(--muted)]" aria-hidden />
                ) : unreadCount > 0 ? (
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--border)] text-[9px] font-medium text-[var(--foreground)]">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                ) : opensPanel && !disabled ? (
                  <ChevronRight size={13} className="shrink-0 text-[var(--muted-light)]" aria-hidden />
                ) : null}
              </button>
            )
          })}
          {showcasePrimaryLinks.length ? (
            <div className="mt-0.5 border-t border-[var(--border)] pt-1">
              {showcasePrimaryLinks.map((link) => {
                const Icon = link.icon
                return (
                  <button
                    key={link.id}
                    type="button"
                    onClick={() => {
                      if (/^https?:\/\//.test(link.href)) window.location.assign(link.href)
                      else router.push(link.href)
                      closeMobileDrawer()
                    }}
                    aria-label={link.label}
                    className="group flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                  >
                    <Icon size={15} />
                    <div className="min-w-0 flex-1 text-left">{link.label}</div>
                  </button>
                )
              })}
            </div>
          ) : null}
        </SidebarNav>

        <SidebarSection className="space-y-3 px-3">
          <div ref={mobileMenuRef} className="relative">
            {!isGuestConfirmed && workspace ? (
              workspace.renderSwitcher?.({
                compact: false,
                onNavigate: () => {
                  setAccountMenuOpen(false)
                  closeMobileDrawer()
                },
                placement: 'footer',
                userLabel: displayName,
                accountMenu: accountMenuContent,
              })
            ) : !isGuestConfirmed ? (
              <>
                {accountMenuOpen ? (
                  <div
                    className="overlay-fade-in absolute bottom-full left-0 right-0 z-50 mb-1 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    {accountMenuContent}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setAccountMenuOpen((value) => !value)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                  aria-label="Account menu"
                >
                  <User size={13} />
                  <span className="flex-1 truncate text-left">{displayName}</span>
                  <ChevronUp size={11} className={`shrink-0 transition-transform ${accountMenuOpen ? '' : 'rotate-180'}`} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => requireAuth('send')}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                aria-label="Sign in"
              >
                <User size={13} />
                <span className="flex-1 text-left">Sign in</span>
              </button>
            )}
          </div>
        </SidebarSection>
      </div>
    </>
  )

  const mobilePanelStep = (
    <>
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--border)] px-2">
        <button
          type="button"
          onClick={() => setMobileView('nav')}
          aria-label="Back to app navigation"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        >
          <ChevronLeft size={16} />
        </button>
        <span
          className="min-w-0 flex-1 truncate px-1 text-lg font-medium lowercase tracking-tight text-[var(--foreground)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {panelTitle}
        </span>
        <button
          type="button"
          onClick={closeMobileDrawer}
          aria-label="Close app navigation"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]"
        >
          <X size={16} />
        </button>
      </div>
      <SecondaryPanelContent
        nav={panelNav}
        action={panelAction}
        search={panelSearch}
      >
        {panelChildren}
      </SecondaryPanelContent>
    </>
  )

  const mobileAccountMenu = (
    <SidebarAccountMenu
      billingEnabled={billingEnabled}
      entitlements={entitlements}
      itemPaddingClass="py-2.5"
      demoHref={!publicShowcase && user ? ROOT_SHOWCASE_DESTINATION : undefined}
      onAccountClick={() => setMobileAccountOpen(false)}
      onSignOut={() => {
        setMobileAccountOpen(false)
        void handleSignOut()
      }}
    />
  )

  return (
    <>
      <div className={`fixed inset-x-0 top-0 z-40 border-b border-[var(--border)] bg-[color:color-mix(in_srgb,var(--sidebar-surface)_95%,transparent)] backdrop-blur transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:hidden ${
        hideTemporaryChatChrome ? 'pointer-events-none -translate-y-full opacity-0' : 'translate-y-0 opacity-100'
      }`}>
        <div className="flex h-14 items-center justify-between gap-2 px-3">
          <button
            type="button"
            onClick={() => {
              setMobileView('nav')
              setMobileMenuOpen(true)
            }}
            aria-label="Open app navigation"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]"
          >
            <Menu size={16} />
          </button>
          <div className="flex min-w-0 flex-1 justify-center px-1">{mobileBrandLink}</div>
          <div className="relative shrink-0" ref={mobileAccountRef}>
            {!isGuestConfirmed && workspace ? (
              <div className="max-w-[min(14rem,calc(100vw-7rem))]">
                {workspace.renderSwitcher?.({
                  compact: true,
                  placement: 'header',
                  userLabel: displayName,
                  onNavigate: () => {
                    setMobileAccountOpen(false)
                    closeMobileDrawer()
                  },
                  accountMenu: mobileAccountMenu,
                })}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setMobileAccountOpen((o) => !o)}
                  aria-label="Account menu"
                  aria-expanded={mobileAccountOpen}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                >
                  <User size={16} />
                </button>
                {mobileAccountOpen && (
                  <div
                    className="overlay-pop-in absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    {mobileAccountMenu}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <AppSidebarPrimaryRail
        brand={railBrand}
        items={railItems}
        footerItems={railFooterItems}
        account={desktopAccountSlot}
        expanded={railExpanded}
        className={`hidden h-full transition-[width,opacity,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:flex ${
          hideTemporaryChatChrome
            ? 'w-0 border-transparent opacity-0 pointer-events-none'
            : `${railExpanded ? 'w-56' : 'w-[72px]'} opacity-100`
        }`}
      />

      {showSecondaryPanel ? (
        <AppSidebarSecondaryPanel
          title={panelTitle}
          nav={panelNav}
          action={panelAction}
          search={panelSearch}
          className={`hidden h-full transition-[width,opacity,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:flex ${
            sidebarCollapsed || hideTemporaryChatChrome
              ? 'w-0 border-transparent opacity-0 pointer-events-none invisible'
              : 'w-60 opacity-100'
          }`}
        >
          {panelChildren}
        </AppSidebarSecondaryPanel>
      ) : null}

      <div className={`fixed inset-0 z-50 md:hidden ${mobileMenuOpen && !hideTemporaryChatChrome ? '' : 'pointer-events-none'}`}>
        <button
          type="button"
          aria-label="Close app navigation"
          onClick={closeMobileDrawer}
          className={`absolute inset-0 bg-black/30 transition-opacity ${mobileMenuOpen && !hideTemporaryChatChrome ? 'opacity-100' : 'opacity-0'}`}
        />
        <SidebarShell
          className={`absolute inset-y-0 left-0 w-[82vw] max-w-[320px] border-r border-[var(--border)] bg-[var(--sidebar-surface)] shadow-[0_20px_80px_rgba(10,10,10,0.18)] transition-transform ${
            mobileMenuOpen && !hideTemporaryChatChrome ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {mobileView === 'panel' && showSecondaryPanel ? mobilePanelStep : mobileNavStep}
        </SidebarShell>
      </div>

      <GlobalSearchDialog
        open={globalSearchOpen}
        onClose={() => setGlobalSearchOpen(false)}
        initialCategory={globalSearchInitialCategory}
        onNewChat={() => {
          void createChat()
        }}
      />
    </>
  )
}
