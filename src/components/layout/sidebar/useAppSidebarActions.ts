'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { beginNavigationIntent } from '@/shared/app/navigation-intent'
import {
  type OverlaySidebarAction,
  type OverlaySidebarActionKey,
} from '@overlay/app-core'
import { createIdempotencyKey, toRequestInit } from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { GateReason } from '@/components/providers/GuestGateProvider'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { newItemScope } from '@/shared/workspaces/panel-scope'

export interface UseAppSidebarActionsOptions {
  user: object | null
  pathname: string
  requireAuth: (reason: GateReason) => void
  onCloseMobileMenu: () => void
}

function isKnownActionKey(actionKey: OverlaySidebarActionKey): actionKey is
  | 'chat.create'
  | 'notes.create'
  | 'automations.create' {
  return (
    actionKey === 'chat.create' ||
    actionKey === 'notes.create' ||
    actionKey === 'automations.create'
  )
}

export function useAppSidebarActions({
  user,
  pathname,
  requireAuth,
  onCloseMobileMenu,
}: UseAppSidebarActionsOptions) {
  const router = useRouter()
  const scope = usePanelScope()
  const buildWorkspaceHref = useWorkspaceHref()
  const createChat = useCallback(async () => {
    if (!user) {
      requireAuth('send')
      return false
    }
    onCloseMobileMenu()
    const view = scope === 'workspace' ? 'workspace-chats' : 'personal'
    const href = buildWorkspaceHref(null, `/app/chat?view=${view}`, scope)
    beginNavigationIntent(href)
    if (pathname.endsWith('/chat')) {
      router.push(href)
      window.dispatchEvent(new CustomEvent('overlay:chat-route-selected', {
        detail: { chatId: null, view },
      }))
    } else {
      router.push(href)
    }
    return true
  }, [
    onCloseMobileMenu,
    pathname,
    buildWorkspaceHref,
    requireAuth,
    router,
    scope,
    user,
  ])

  const startAutomationDraft = useCallback(() => {
    if (!user) {
      requireAuth('send')
      return false
    }
    onCloseMobileMenu()
    beginNavigationIntent(buildWorkspaceHref(null, '/app/automations', scope))
    router.push(buildWorkspaceHref(null, '/app/automations', scope))
    return true
  }, [buildWorkspaceHref, onCloseMobileMenu, requireAuth, router, scope, user])

  const createNote = useCallback(async () => {
    if (!user) {
      requireAuth('nav')
      return false
    }
    const idempotencyKey = createIdempotencyKey()
    const res = await overlayAppClient.notes.createResponse(
      {
        title: 'Untitled',
        content: '',
        scope: newItemScope(scope),
      },
      toRequestInit({ idempotencyKey }),
    )
    if (!res.ok) return false
    const data = await res.json() as {
      id?: string
      note?: {
        _id: string
        title?: string
        content?: string
        tags?: string[]
        createdAt?: number
        updatedAt?: number
      }
    }
    const noteId = data.id ?? data.note?._id
    if (!noteId) return false
    onCloseMobileMenu()
    router.push(buildWorkspaceHref(null, `/app/notes?id=${encodeURIComponent(noteId)}`, scope))
    return true
  }, [buildWorkspaceHref, onCloseMobileMenu, requireAuth, router, scope, user])

  const runSidebarAction = useCallback(async (action: OverlaySidebarAction | null | undefined) => {
    if (!action) return false
    if (action.requiresAuth && !user) {
      requireAuth(action.actionKey === 'chat.create' || action.actionKey === 'automations.create' ? 'send' : 'nav')
      return false
    }
    if (!isKnownActionKey(action.actionKey)) {
      window.dispatchEvent(new CustomEvent('overlay:sidebar-action', { detail: { action } }))
      return false
    }
    if (action.actionKey === 'chat.create') return createChat()
    if (action.actionKey === 'notes.create') return createNote()
    return startAutomationDraft()
  }, [
    createChat,
    createNote,
    requireAuth,
    startAutomationDraft,
    user,
  ])

  return {
    createChat,
    runSidebarAction,
  }
}
