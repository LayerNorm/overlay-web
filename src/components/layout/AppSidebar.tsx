'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore, Suspense } from 'react'
import {
  MessageSquare, User,
  ChevronUp, Plug, Sparkles, Server, Package,
  Loader2, Menu, X, Settings, ChevronDown, ChevronLeft, ChevronRight, ShieldCheck,
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
  SidebarResourceSection,
} from '@overlay/ui/primitives'
import {
  FilesInlinePanel,
  InlineNavChildren,
  ProjectsInlinePanel,
  toolsInlineItems,
} from '@/components/layout/AppSidebarInlinePanels'
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
  getSidebarCollapsedSnapshot,
  setStoredSidebarCollapsed,
  subscribeToSidebarCollapsed,
} from './sidebar/sidebarCollapsedStore'
import { SidebarAccountMenu } from './sidebar/SidebarAccountMenu'
import { ICON_COMPONENTS, toMentionCategory } from './sidebar/sidebarNavigation'
import type { SidebarEntitlements } from './sidebar/SidebarUsageMeters'
import type { AppSidebarProps } from './appSidebarTypes'

export type {
  AppSidebarChatPanelContext,
  AppSidebarNavigateContext,
  AppSidebarProps,
} from './appSidebarTypes'

export default function AppSidebar({
  publicShowcase = false,
  renderChatPanel,
  renderAutomationsPanel,
  renderFilesPanel,
  renderProjectsPanel,
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

  const [pendingNav, setPendingNav] = useState<{ href: string; fromPath: string } | null>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [entitlements, setEntitlements] = useState<SidebarEntitlements | null>(null)
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false)
  const [temporaryChatUiHidden, setTemporaryChatUiHidden] = useState(false)
  const storedSidebarCollapsed = useSyncExternalStore(
    subscribeToSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    () => false,
  )
  const [showcaseSidebarCollapsed, setShowcaseSidebarCollapsed] = useState(false)
  const sidebarCollapsed = publicShowcase ? showcaseSidebarCollapsed : storedSidebarCollapsed
  const setSidebarCollapsed = useCallback((next: boolean) => {
    if (publicShowcase) setShowcaseSidebarCollapsed(next)
    else setStoredSidebarCollapsed(next)
  }, [publicShowcase])
  const [chatPanelRefreshKey, setChatPanelRefreshKey] = useState(0)
  const [projectsPanelRefreshKey, setProjectsPanelRefreshKey] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const mobileAccountRef = useRef<HTMLDivElement>(null)
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
    searchParams: currentSearchParams,
    isFreeTier: sidebarIsFreeTier,
    requireAuth,
    onCloseMobileMenu: () => setMobileMenuOpen(false),
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
        setMobileAccountOpen(false)
        setAccountMenuOpen(false)
      }
    }

    window.addEventListener(TEMPORARY_CHAT_UI_EVENT, onTemporaryChatUi)
    return () => window.removeEventListener(TEMPORARY_CHAT_UI_EVENT, onTemporaryChatUi)
  }, [])

  const effectivePendingHref =
    pendingNav && pathname === pendingNav.fromPath ? pendingNav.href : null
  const hideTemporaryChatChrome = temporaryChatUiHidden && pathname.startsWith('/app/chat')
  const projectsOpen = pathname.startsWith('/app/projects')
  const notesOpen = pathname.startsWith('/app/notes')
  const filesOpen = pathname.startsWith('/app/files')
  const filesSectionOpen = filesOpen || notesOpen
  const chatOpen = pathname.startsWith('/app/chat')
  const adminOpen = pathname.startsWith('/app/admin')
  const showAdminNavigation = can('administration.access') && !publicShowcase && Boolean(user)
  const automationsOpen = pathname.startsWith('/app/automations')
  const automationsSectionOpen = automationsOpen && capabilities.automations
  const settingsPathActive = pathname.startsWith('/app/settings')
  const settingsSection = currentSearchParams.get('section') ?? 'general'
  const toolsView = (() => {
    const current = currentSearchParams.get('view')
    if (current === 'skills') return 'skills'
    if (current === 'mcps') return 'mcps'
    if (current === 'apps') return 'apps'
    if (current === 'installed') return 'installed'
    return 'connectors'
  })()
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
        if (pathname.startsWith('/app/settings')) return
        if (isGuestConfirmed) { requireAuth('settings'); return }
        setMobileMenuOpen(false)
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
      if (pathname.startsWith(item.href)) return
      if (isGuestConfirmed && !publicShowcase && item.href !== '/app/chat') { requireAuth('nav'); return }
      setPendingNav({ href: item.href, fromPath: pathname })
      router.push(publicShowcase
        ? `${item.href}?${new URLSearchParams({
            showcase: '1',
            ...(item.href === '/app/chat' ? { id: 'showcase-welcome' } : {}),
          }).toString()}`
        : item.href)
    }
    window.addEventListener('keydown', onNavShortcut, true)
    return () => window.removeEventListener('keydown', onNavShortcut, true)
  }, [pathname, router, navItems, isGuestConfirmed, publicShowcase, requireAuth])

  /** Sub-items only while the settings route is open (avoids orphan dropdown state off-route). */
  const settingsNavExpanded = settingsPathActive

  useEffect(() => {
    if (!accountMenuOpen) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [accountMenuOpen])

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

  const brandLink = (
    <Link
      href={publicShowcase ? '/app/chat?showcase=1&id=showcase-welcome' : brandConfig.homeHref}
      className="flex min-w-0 items-center gap-2"
      onClick={() => setMobileMenuOpen(false)}
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

  const desktopBrandControl = sidebarCollapsed ? (
    <button
      type="button"
      onClick={() => setSidebarCollapsed(false)}
      className="group inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-subtle)]"
      aria-label="Expand sidebar"
      title="Expand sidebar"
    >
      <Image src={brandConfig.logoSrc} alt={brandConfig.logoAlt ?? ''} width={10} height={10} className="shrink-0 group-hover:hidden" />
      <ChevronRight size={16} className="hidden text-[var(--foreground)] group-hover:block" />
    </button>
  ) : (
    brandLink
  )

  /** Compact brand for the fixed mobile top bar (matches sidebar identity). */
  const mobileBrandLink = (
    <Link
      href={publicShowcase ? '/app/chat?showcase=1&id=showcase-welcome' : brandConfig.homeHref}
      className="flex min-w-0 max-w-[calc(100vw-8rem)] items-center gap-2"
      onClick={() => setMobileMenuOpen(false)}
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

  // Global Cmd/Ctrl+K command palette. The same dialog is reused by the per-section
  // search buttons in the sidebar; passing `globalSearchInitialCategory` opens it
  // pre-filtered to the current section (chats, files, …).
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchInitialCategory, setGlobalSearchInitialCategory] = useState<MentionType | null>(null)
  const openGlobalSearch = useCallback((category: MentionType | null) => {
    setGlobalSearchInitialCategory(category)
    setGlobalSearchOpen(true)
  }, [])
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

  const contextualAction = resolveSidebarActionForPath(pathname, sidebarActions)
  const contextualSearchCategory = toMentionCategory(contextualAction?.searchCategory)
  const hasInlineChildren = (href?: string) =>
    href === '/app/tools'

  const sidebarContent = (
    <>
      <div
        className={`hidden h-16 min-h-16 shrink-0 items-center border-b border-[var(--border)] md:flex ${
          sidebarCollapsed ? 'justify-center px-4' : 'justify-between px-5'
        }`}
      >
        {desktopBrandControl}
        {!sidebarCollapsed ? (
          <button
            type="button"
            onClick={() => {
              setAccountMenuOpen(false)
              setSidebarCollapsed(true)
            }}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
          >
            <ChevronLeft size={16} />
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <SidebarNav className="shrink-0">
          {showAdminNavigation ? (
            <button
              type="button"
              onClick={() => {
                if (adminOpen) return
                setMobileMenuOpen(false)
                setPendingNav({ href: '/app/admin', fromPath: pathname })
                router.push('/app/admin')
              }}
              title="Admin"
              aria-label="Admin"
              aria-current={adminOpen ? 'page' : undefined}
              className={`group flex h-9 w-full items-center rounded-md px-3 text-sm transition-colors ${
                adminOpen
                  ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
              } ${sidebarCollapsed ? 'justify-center' : 'gap-2.5'}`}
            >
              {sidebarCollapsed && effectivePendingHref === '/app/admin' ? (
                <Loader2 size={14} className="shrink-0 animate-spin text-[var(--muted)]" aria-hidden />
              ) : (
                <ShieldCheck size={15} />
              )}
              {!sidebarCollapsed ? <div className="min-w-0 flex-1 text-left">Admin</div> : null}
            </button>
          ) : null}
          {navItems.map((item, navIdx) => {
            const { href, label, icon: Icon, disabled } = item
            const active =
              href &&
              (effectivePendingHref
                ? effectivePendingHref === href
                : href === '/app/files'
                  ? filesSectionOpen
                  : pathname.startsWith(href))
            const isPending = href && effectivePendingHref === href
            const unreadCount = href === '/app/chat' ? totalUnread : 0
            const shortcut = navIdx < 9 ? navIdx + 1 : null
            const showShortcut = Boolean(shortcut) && !active
            const showChevron = hasInlineChildren(href)
            const commonClass = `group flex h-9 w-full items-center rounded-md px-3 text-sm transition-colors ${
              disabled
                ? 'cursor-not-allowed text-[var(--muted-light)]'
                : active
                  ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
            } ${sidebarCollapsed ? 'justify-center' : 'gap-2.5'}`
            if (disabled) {
              return (
                <button
                  key={label}
                  type="button"
                  disabled
                  title="Coming soon"
                  aria-label={`${label} (coming soon)`}
                  className={commonClass}
                >
                  <Icon size={15} />
                  {!sidebarCollapsed ? <div className="min-w-0 flex-1 text-left">{label}</div> : null}
                </button>
              )
            }
            return (
              <div key={href}>
                <button
                  type="button"
                  onClick={() => {
                    if (!href) return
                    if (isGuestConfirmed && !publicShowcase && href !== '/app/chat') {
                      requireAuth('nav')
                      return
                    }
                    const primaryNavAction = primaryNavActionByItemId.get(item.id)
                    if (primaryNavAction) {
                      void runSidebarAction(primaryNavAction)
                      return
                    }
                    if (pathname.startsWith(href)) return
                    setMobileMenuOpen(false)
                    const destination = publicShowcase
                      ? `${href}?${new URLSearchParams({
                          showcase: '1',
                          ...(href === '/app/chat' ? { id: 'showcase-welcome' } : {}),
                        }).toString()}`
                      : href
                    setPendingNav({ href: destination, fromPath: pathname })
                    router.push(destination)
                  }}
                  title={shortcut ? `${label} · ⌥${shortcut}` : label}
                  aria-label={label}
                  data-tour={href === '/app/chat' ? 'nav-chat' : href === '/app/files' ? 'nav-knowledge' : href === '/app/tools' ? 'nav-extensions' : undefined}
                  className={commonClass}
                >
                  {sidebarCollapsed && isPending ? (
                    <Loader2 size={14} className="shrink-0 animate-spin text-[var(--muted)]" aria-hidden />
                  ) : (
                    <Icon size={15} />
                  )}
                  {!sidebarCollapsed ? (
                    <div className="min-w-0 flex-1 text-left">
                      <div>{label}</div>
                    </div>
                  ) : null}
                  {!sidebarCollapsed && showShortcut ? (
                    <span
                      className={`shrink-0 text-[10px] font-medium tabular-nums transition-opacity ${
                        active
                          ? 'text-[var(--muted)] opacity-100'
                          : 'text-[var(--muted-light)] opacity-0 group-hover:opacity-100'
                      }`}
                      aria-hidden
                    >
                      ⌥{shortcut}
                    </span>
                  ) : null}
                  {!sidebarCollapsed && showChevron ? (
                    <span
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-opacity ${
                        active
                          ? 'text-[var(--muted)] opacity-100'
                          : 'text-[var(--muted-light)] opacity-0 group-hover:opacity-100 hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
                      }`}
                      aria-hidden
                    >
                      <ChevronDown
                        size={13}
                        className={`transition-transform ${active ? '' : '-rotate-90'}`}
                      />
                    </span>
                  ) : null}
                  {!sidebarCollapsed && isPending ? (
                    <Loader2
                      size={14}
                      className="shrink-0 animate-spin text-[var(--muted)]"
                      aria-hidden
                    />
                  ) : !sidebarCollapsed && unreadCount > 0 ? (
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--border)] text-[9px] font-medium text-[var(--foreground)]">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  ) : null}
                </button>
                {!sidebarCollapsed && href === '/app/tools' && active ? (
                  <InlineNavChildren
                    items={availableToolsInlineItems}
                    activeId={toolsView}
                    onSelect={(next) => {
                      setMobileMenuOpen(false)
                      router.push(`/app/tools?${new URLSearchParams({
                        ...(publicShowcase ? { showcase: '1' } : {}),
                        view: next,
                      }).toString()}`)
                    }}
                  />
                ) : null}
                {sidebarCollapsed && href === '/app/tools' && active ? (
                  <div className="mx-2 mt-1 flex flex-col overflow-hidden rounded-md border border-[var(--border)]">
                    {availableToolsInlineItems.map((item) => {
                      const sub = {
                        connectors: { id: 'connectors', Icon: Plug, label: 'Connectors', locked: false },
                        skills: { id: 'skills', Icon: Sparkles, label: 'Skills', locked: false },
                        mcps: { id: 'mcps', Icon: Server, label: 'MCPs', locked: false },
                        apps: { id: 'apps', Icon: Package, label: 'Apps', locked: true },
                      }[item.id]
                      return sub ? (
                        <button
                          key={sub.id}
                          type="button"
                          title={sub.locked ? `${sub.label} · Soon` : sub.label}
                          aria-label={sub.label}
                          disabled={sub.locked}
                          onClick={() => {
                            if (sub.locked) return
                            router.push(`/app/tools?${new URLSearchParams({
                              ...(publicShowcase ? { showcase: '1' } : {}),
                              view: sub.id,
                            }).toString()}`)
                          }}
                          className={`flex h-8 items-center justify-center transition-colors ${
                            sub.locked
                              ? 'cursor-default text-[var(--muted-light)]'
                              : toolsView === sub.id
                                ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
                                : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
                          }`}
                        >
                          <sub.Icon size={13} />
                        </button>
                      ) : null
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
          <div className="mt-0.5">
            <button
              type="button"
              onClick={() => {
                if (settingsPathActive) return
                if (!user) { requireAuth('settings'); return }
                setMobileMenuOpen(false)
                setPendingNav({ href: '/app/settings', fromPath: pathname })
                router.push('/app/settings')
              }}
              title="Settings · ⌥7"
              aria-label="Settings"
              className={`group flex h-9 w-full items-center rounded-md px-3 text-sm transition-colors ${
                settingsPathActive
                  ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
                  : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
              } ${sidebarCollapsed ? 'justify-center' : 'gap-2.5'}`}
            >
              <Settings size={15} />
              {!sidebarCollapsed ? <div className="min-w-0 flex-1 text-left">Settings</div> : null}
              {!sidebarCollapsed ? (
                <span
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--muted-light)] opacity-0 transition-opacity group-hover:opacity-100 ${
                    settingsNavExpanded ? '' : '-rotate-90'
                  }`}
                  aria-hidden
                >
                  <ChevronDown size={13} />
                </span>
              ) : null}
            </button>
            {!sidebarCollapsed && settingsNavExpanded ? (
              <div className="mt-1 space-y-0.5 pl-7">
                {settingsSections.map(({ id, label, href: sectionHref }) => {
                  const active = settingsPathActive && settingsSection === id
                  return (
                    <Link
                      key={id}
                      href={sectionHref ?? `/app/settings?section=${id}`}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex w-full items-center rounded-md px-3 py-1.5 text-xs transition-colors ${
                        active
                          ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
                          : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      <span className="flex-1 text-left">{label}</span>
                    </Link>
                  )
                })}
              </div>
            ) : null}
          </div>
        </SidebarNav>

        {!sidebarCollapsed && (chatOpen || filesSectionOpen || projectsOpen || automationsSectionOpen) ? (
          <SidebarResourceSection
            action={contextualAction ? {
              label: contextualAction.label,
              onClick: () => publicShowcase ? requireAuth('nav') : void runSidebarAction(contextualAction),
            } : null}
            search={contextualSearchCategory ? {
              title: contextualSearchCategory === 'chat' ? 'Search chats (\u2318K)' : 'Search files (\u2318K)',
              onClick: () => publicShowcase ? requireAuth('history') : openGlobalSearch(contextualSearchCategory),
            } : null}
          >
            <Suspense fallback={<SidebarListSkeleton />}>
              {chatOpen && renderChatPanel
                ? renderChatPanel({
                    refreshKey: chatPanelRefreshKey,
                    onNavigate: () => setMobileMenuOpen(false),
                  })
                : null}
              {notesOpen || filesOpen ? (
                renderFilesPanel
                  ? renderFilesPanel({ onNavigate: () => setMobileMenuOpen(false) })
                  : <FilesInlinePanel searchQuery="" onNavigate={() => setMobileMenuOpen(false)} />
              ) : null}
              {projectsOpen ? (
                renderProjectsPanel
                  ? renderProjectsPanel({ onNavigate: () => setMobileMenuOpen(false) })
                  : <ProjectsInlinePanel refreshKey={projectsPanelRefreshKey} onNavigate={() => setMobileMenuOpen(false)} />
              ) : null}
              {automationsSectionOpen && renderAutomationsPanel
                ? renderAutomationsPanel({
                    onNavigate: () => setMobileMenuOpen(false),
                  })
                : null}
            </Suspense>
          </SidebarResourceSection>
        ) : null}
      </div>

      <SidebarSection className={`space-y-3 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
        {publicShowcase && !sidebarCollapsed ? (
          <nav aria-label="Overlay information" className="grid grid-cols-2 gap-x-3 gap-y-1 px-2 text-[11px] text-[var(--muted)]">
            <Link href="/app/home?showcase=1" className="hover:text-[var(--foreground)]">Home</Link>
            <Link href="/app/manifesto?showcase=1" className="hover:text-[var(--foreground)]">Manifesto</Link>
            <Link href="/app/pricing?showcase=1" className="hover:text-[var(--foreground)]">Pricing</Link>
            <Link href="https://github.com/DevelopedByDev/overlay-web#readme" className="hover:text-[var(--foreground)]">Docs</Link>
          </nav>
        ) : null}
        <div ref={menuRef} className="relative">
          {accountMenuOpen && (
            <div
              className={`overlay-fade-in absolute bottom-full z-50 mb-1 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg ${
                sidebarCollapsed ? 'left-0 w-64' : 'left-0 right-0'
              }`}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <SidebarAccountMenu
                billingEnabled={billingEnabled}
                entitlements={entitlements}
                onAccountClick={() => {
                  setAccountMenuOpen(false)
                  setMobileMenuOpen(false)
                }}
                onSignOut={() => {
                  setAccountMenuOpen(false)
                  void handleSignOut()
                }}
              />
            </div>
          )}

          {!isGuestConfirmed ? (
            <button
              type="button"
              onClick={() => setAccountMenuOpen((value) => !value)}
              className={`flex w-full items-center rounded-md px-2 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${
                sidebarCollapsed ? 'justify-center' : 'gap-2'
              }`}
              aria-label="Account menu"
            >
              <User size={13} />
              {!sidebarCollapsed ? <span className="flex-1 truncate text-left">{displayName}</span> : null}
              {!sidebarCollapsed ? <ChevronUp size={11} className={`shrink-0 transition-transform ${accountMenuOpen ? '' : 'rotate-180'}`} /> : null}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => requireAuth('send')}
              className={`flex w-full items-center rounded-md px-2 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${
                sidebarCollapsed ? 'justify-center' : 'gap-2'
              }`}
              aria-label="Sign in"
            >
              <User size={13} />
              {!sidebarCollapsed ? <span className="flex-1 text-left">Sign in</span> : null}
            </button>
          )}
        </div>
      </SidebarSection>
    </>
  )

  return (
    <>
      <div className={`fixed inset-x-0 top-0 z-40 border-b border-[var(--border)] bg-[color:color-mix(in_srgb,var(--sidebar-surface)_95%,transparent)] backdrop-blur transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:hidden ${
        hideTemporaryChatChrome ? 'pointer-events-none -translate-y-full opacity-0' : 'translate-y-0 opacity-100'
      }`}>
        <div className="flex h-14 items-center justify-between gap-2 px-3">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open app navigation"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]"
          >
            <Menu size={16} />
          </button>
          <div className="flex min-w-0 flex-1 justify-center px-1">{mobileBrandLink}</div>
          <div className="relative shrink-0" ref={mobileAccountRef}>
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
                <SidebarAccountMenu
                  billingEnabled={billingEnabled}
                  entitlements={entitlements}
                  itemPaddingClass="py-2.5"
                  onAccountClick={() => setMobileAccountOpen(false)}
                  onSignOut={() => {
                    setMobileAccountOpen(false)
                    void handleSignOut()
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <SidebarShell
        className={`hidden h-full transition-[width,opacity,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] md:flex ${
          hideTemporaryChatChrome
            ? 'w-0 border-transparent opacity-0 pointer-events-none'
            : `${sidebarCollapsed ? 'w-[72px]' : 'w-56'} opacity-100`
        }`}
      >
        {sidebarContent}
      </SidebarShell>

      <div className={`fixed inset-0 z-50 md:hidden ${mobileMenuOpen && !hideTemporaryChatChrome ? '' : 'pointer-events-none'}`}>
        <button
          type="button"
          aria-label="Close app navigation"
          onClick={() => setMobileMenuOpen(false)}
          className={`absolute inset-0 bg-black/30 transition-opacity ${mobileMenuOpen && !hideTemporaryChatChrome ? 'opacity-100' : 'opacity-0'}`}
        />
        <SidebarShell
          className={`absolute inset-y-0 left-0 w-[82vw] max-w-[320px] border-r border-[var(--border)] bg-[var(--sidebar-surface)] shadow-[0_20px_80px_rgba(10,10,10,0.18)] transition-transform ${
            mobileMenuOpen && !hideTemporaryChatChrome ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4">
            <div className="min-w-0 flex-1">{brandLink}</div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close app navigation"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)]"
            >
              <X size={16} />
            </button>
          </div>
          {sidebarContent}
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
