'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { useHotkeys } from 'react-hotkeys-hook'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { coalesceRequest } from '@/shared/observability/request-coalescer'
import { categorizeCollaborationUnreadNotifications } from '@/shared/chat/notification-badges'
import type { CachedConversation } from '@/shared/chat/chat-list-cache'
import { TEMPORARY_CHAT_UI_EVENT, type TemporaryChatUiEventDetail } from '@/shared/chat/temporary-chat-ui'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import { requireShortcutHotkey } from '@/shared/shortcuts/shortcut-registry'
import type { WorkspaceNotification } from '@overlay/workspace-contracts'
import type { GateReason } from '@/components/providers/GuestGateProvider'
import type { MentionType } from '@/shared/knowledge/mention-types'
import type { SidebarEntitlements } from './SidebarUsageMeters'
import { NAV_HOTKEY_OPTIONS, type SidebarNavItem } from './appSidebarNav'

export function useTemporaryChatUiHidden({
  pathname,
  resolveWorkspaceSurface,
  onHide,
}: {
  pathname: string
  resolveWorkspaceSurface: (path: string) => string | null
  onHide: () => void
}): boolean {
  const [temporaryChatUiHidden, setTemporaryChatUiHidden] = useState(false)

  useEffect(() => {
    function onTemporaryChatUi(event: Event) {
      const active = Boolean((event as CustomEvent<TemporaryChatUiEventDetail>).detail?.active)
      setTemporaryChatUiHidden(active)
      if (active) onHide()
    }

    window.addEventListener(TEMPORARY_CHAT_UI_EVENT, onTemporaryChatUi)
    return () => window.removeEventListener(TEMPORARY_CHAT_UI_EVENT, onTemporaryChatUi)
  }, [onHide])

  const hideTemporaryChatChrome = temporaryChatUiHidden && (
    pathname.startsWith('/app/chat') ||
    (pathname.startsWith('/app/w/') && resolveWorkspaceSurface(pathname) === 'chat')
  )

  useEffect(() => {
    document.documentElement.toggleAttribute('data-temporary-chat-ui', hideTemporaryChatChrome)
    return () => document.documentElement.removeAttribute('data-temporary-chat-ui')
  }, [hideTemporaryChatChrome])

  return hideTemporaryChatChrome
}

export function useCollaborationUnread({
  publicShowcase,
  user,
  activeWorkspaceId,
  collaborationNotifications,
}: {
  publicShowcase: boolean
  user: object | null
  activeWorkspaceId: string | null
  collaborationNotifications: WorkspaceNotification[]
}): { dms: number; channels: number; total: number } {
  const [collaborationUnread, setCollaborationUnread] = useState({ dms: 0, channels: 0, total: 0 })

  useEffect(() => {
    if (publicShowcase || !user || !activeWorkspaceId) {
      return
    }
    let cancelled = false
    const categorizeUnread = async () => {
      try {
        const unreadNotifications = collaborationNotifications.filter((notification) => !notification.readAt)
        let conversations: CachedConversation[] = []
        if (unreadNotifications.length > 0) {
          try {
            const page = await overlayAppClient.conversations.getPage<CachedConversation>({ view: 'all', limit: 100 })
            conversations = page.data
          } catch {
            // Activity remains complete even when the conversation directory is briefly unavailable.
          }
        }
        if (!cancelled) {
          setCollaborationUnread(categorizeCollaborationUnreadNotifications(unreadNotifications, conversations))
        }
      } catch {
        // The primary chat navigation stays usable while conversation categorization retries.
      }
    }
    void categorizeUnread()
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, collaborationNotifications, publicShowcase, user])

  return collaborationUnread
}

export function useUnreadChatRedirect({
  chatViewParam,
  activeWorkspaceId,
  buildWorkspaceHref,
}: {
  chatViewParam: string | null
  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string) => string
}) {
  useEffect(() => {
    // Unread was folded into Activity; rewrite stale deep links.
    if (chatViewParam !== 'unread') return
    window.history.replaceState(null, '', activeWorkspaceId
      ? buildWorkspaceHref(activeWorkspaceId, '/app/activity')
      : '/app/activity')
  }, [activeWorkspaceId, buildWorkspaceHref, chatViewParam])
}

export function useSidebarEntitlements({
  billingEnabled,
  authLoading,
  authUserId,
  activeWorkspaceId,
  accountMenuOpen,
  mobileAccountOpen,
  filesSectionOpen,
}: {
  billingEnabled: boolean
  authLoading: boolean
  authUserId: string | null
  activeWorkspaceId: string | null
  accountMenuOpen: boolean
  mobileAccountOpen: boolean
  filesSectionOpen: boolean
}): SidebarEntitlements | null {
  const [entitlements, setEntitlements] = useState<SidebarEntitlements | null>(null)

  const loadEntitlements = useCallback(async () => {
    if (!billingEnabled || authLoading || !authUserId) {
      setEntitlements(null)
      return
    }
    const cacheKey = `billing:${activeWorkspaceId ?? 'personal'}`
    try {
      const data = await coalesceRequest(cacheKey, async () => {
        const res = await overlayAppClient.subscription.getResponse({
          cache: 'no-store',
          ...(activeWorkspaceId
            ? { headers: { [ACTIVE_WORKSPACE_HEADER]: activeWorkspaceId } }
            : {}),
        })
        if (!res.ok) return null
        return await res.json()
      })
      if (data) setEntitlements(data)
    } catch {
      // ignore
    }
  }, [activeWorkspaceId, authLoading, authUserId, billingEnabled, setEntitlements])

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
    const intervalId = window.setInterval(() => { void loadEntitlements() }, 60_000)
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

  return entitlements
}

export function useSidebarNavHotkeys({
  navItems,
  pathname,
  workspaceSurface,
  canonicalWorkspaceRoute,
  resolveWorkspaceSurface,
  settingsPathActive,
  isGuestConfirmed,
  publicShowcase,
  activeWorkspaceId,
  buildWorkspaceHref,
  requireAuth,
  setPendingNav,
  closeMobileDrawer,
}: {
  navItems: SidebarNavItem[]
  pathname: string
  workspaceSurface: string | null
  canonicalWorkspaceRoute: boolean
  resolveWorkspaceSurface: (path: string) => string | null
  settingsPathActive: boolean
  isGuestConfirmed: boolean
  publicShowcase: boolean
  activeWorkspaceId: string | null
  buildWorkspaceHref: (workspaceId: string, href: string) => string
  requireAuth: (reason: GateReason) => void
  setPendingNav: Dispatch<SetStateAction<{ href: string; fromPath: string } | null>>
  closeMobileDrawer: () => void
}) {
  const router = useRouter()

  // Bound through react-hotkeys-hook from the shared registry so Settings →
  // Shortcuts always documents the chord that is actually listening.
  useHotkeys(
    requireShortcutHotkey('navigation.settings'),
    () => {
      if (settingsPathActive) return
      if (isGuestConfirmed) { requireAuth('settings'); return }
      closeMobileDrawer()
      setPendingNav({ href: '/app/settings', fromPath: pathname })
      router.push('/app/settings')
    },
    NAV_HOTKEY_OPTIONS,
    [isGuestConfirmed, pathname, requireAuth, router, settingsPathActive],
  )

  useHotkeys(
    requireShortcutHotkey('navigation.section'),
    (event) => {
      const match = /^Digit([1-6])$/.exec(event.code)
      if (!match) return
      const item = navItems[parseInt(match[1]!, 10) - 1]
      if (!item || item.disabled || !item.href) return
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
    },
    NAV_HOTKEY_OPTIONS,
    [
      activeWorkspaceId,
      buildWorkspaceHref,
      canonicalWorkspaceRoute,
      isGuestConfirmed,
      navItems,
      pathname,
      publicShowcase,
      requireAuth,
      router,
      workspaceSurface,
      resolveWorkspaceSurface,
    ],
  )
}

export function useGlobalSearch(): {
  globalSearchOpen: boolean
  globalSearchInitialCategory: MentionType | null
  openGlobalSearch: (category: MentionType | null) => void
  closeGlobalSearch: () => void
} {
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
  useHotkeys(
    requireShortcutHotkey('global.search'),
    () => {
      setGlobalSearchInitialCategory(null)
      setGlobalSearchOpen((prev) => !prev)
    },
    // Search must open from anywhere, including the composer and other inputs.
    { preventDefault: true, enableOnFormTags: true, enableOnContentEditable: true },
  )
  return {
    globalSearchOpen,
    globalSearchInitialCategory,
    openGlobalSearch,
    closeGlobalSearch: () => setGlobalSearchOpen(false),
  }
}

export function useClickOutside(
  ref: { current: HTMLElement | null },
  open: boolean,
  onOpenChange: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [open, ref, onOpenChange])
}

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [locked])
}
