'use client'

import { useLiveWorkspaceEntitlements } from '@/hooks/use-billing'
import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { useHotkeys } from 'react-hotkeys-hook'
import { categorizeCollaborationUnreadNotifications } from '@/shared/chat/notification-badges'
import { TEMPORARY_CHAT_UI_EVENT, type TemporaryChatUiEventDetail } from '@/shared/chat/temporary-chat-ui'
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
  user,
  activeWorkspaceId,
  collaborationNotifications,
}: {
  user: object | null
  activeWorkspaceId: string | null
  collaborationNotifications: WorkspaceNotification[]
}): { dms: number; channels: number; total: number } {
  // Each live notification carries its room type, so the counts need no conversation lookup.
  return useMemo(() => (
    user && activeWorkspaceId
      ? categorizeCollaborationUnreadNotifications(collaborationNotifications.filter((notification) => !notification.readAt))
      : { dms: 0, channels: 0, total: 0 }
  ), [activeWorkspaceId, collaborationNotifications, user])
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
}: {
  billingEnabled: boolean
  authLoading: boolean
  authUserId: string | null
  activeWorkspaceId: string | null
}): SidebarEntitlements | null {
  // Live: usage meters follow each charge, top-up and payment without polling while the menu is open.
  const live = useLiveWorkspaceEntitlements<SidebarEntitlements>(
    activeWorkspaceId,
    billingEnabled && !authLoading && Boolean(authUserId),
  )
  return live ?? null
}

export function useSidebarNavHotkeys({
  navItems,
  pathname,
  workspaceSurface,
  canonicalWorkspaceRoute,
  resolveWorkspaceSurface,
  settingsPathActive,
  isGuestConfirmed,

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
      if (isGuestConfirmed && item.href !== '/app/chat') { requireAuth('nav'); return }
      const workspaceHref = activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, item.href)
        : item.href
      setPendingNav({ href: workspaceHref, fromPath: pathname })
      router.push(workspaceHref)
    },
    NAV_HOTKEY_OPTIONS,
    [
      activeWorkspaceId,
      buildWorkspaceHref,
      canonicalWorkspaceRoute,
      isGuestConfirmed,
      navItems,
      pathname,

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
