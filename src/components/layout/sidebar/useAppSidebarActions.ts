'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  KNOWLEDGE_ENTITY_MUTATION_EVENT,
  PROJECTS_CHANGED_EVENT,
  createKnowledgeMutationPublisher,
  type OverlaySidebarAction,
  type OverlaySidebarActionKey,
} from '@overlay/app-core'
import { createIdempotencyKey, toRequestInit } from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { GateReason } from '@/components/providers/GuestGateProvider'

const nextSidebarActionMutation = createKnowledgeMutationPublisher(
  `web-sidebar-action:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
)

function publishCreatedNote(id: string): void {
  window.dispatchEvent(new CustomEvent(KNOWLEDGE_ENTITY_MUTATION_EVENT, {
    detail: nextSidebarActionMutation({ entity: 'note', id, operation: 'created' }),
  }))
}

export interface UseAppSidebarActionsOptions {
  user: object | null
  pathname: string
  isFreeTier?: boolean
  requireAuth: (reason: GateReason) => void
  onCloseMobileMenu: () => void
  onChatCreated: () => void
  onProjectCreated: () => void
}

function isKnownActionKey(actionKey: OverlaySidebarActionKey): actionKey is
  | 'chat.create'
  | 'notes.create'
  | 'projects.create'
  | 'automations.create' {
  return (
    actionKey === 'chat.create' ||
    actionKey === 'notes.create' ||
    actionKey === 'projects.create' ||
    actionKey === 'automations.create'
  )
}

export function useAppSidebarActions({
  user,
  pathname,
  requireAuth,
  onCloseMobileMenu,
  onChatCreated,
  onProjectCreated,
}: UseAppSidebarActionsOptions) {
  const router = useRouter()
  const createChat = useCallback(async () => {
    if (!user) {
      requireAuth('send')
      return false
    }
    onChatCreated()
    onCloseMobileMenu()
    const href = '/app/chat'
    if (pathname === '/app/chat') {
      window.history.pushState(null, '', href)
      window.dispatchEvent(new CustomEvent('overlay:chat-route-selected', {
        detail: { chatId: null, view: 'personal' },
      }))
    } else {
      router.push(href)
    }
    return true
  }, [
    onChatCreated,
    onCloseMobileMenu,
    pathname,
    requireAuth,
    router,
    user,
  ])

  const startAutomationDraft = useCallback(() => {
    if (!user) {
      requireAuth('send')
      return false
    }
    onCloseMobileMenu()
    router.push('/app/automations')
    return true
  }, [onCloseMobileMenu, requireAuth, router, user])

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
        projectId?: string
      }
    }
    const noteId = data.id ?? data.note?._id
    if (!noteId) return false
    publishCreatedNote(noteId)
    onCloseMobileMenu()
    router.push(`/app/notes?id=${encodeURIComponent(noteId)}`)
    return true
  }, [onCloseMobileMenu, requireAuth, router, user])

  const createProject = useCallback(async () => {
    if (!user) {
      requireAuth('nav')
      return false
    }
    const res = await overlayAppClient.projects.createResponse({ name: 'Untitled Project' })
    if (!res.ok) return false
    const data = (await res.json().catch(() => ({}))) as {
      id?: string
      project?: { _id?: string }
    }
    const createdId = data.project?._id ?? data.id
    // The projects page listens for this to reload, and the `rename` query
    // param puts the new tile straight into inline rename with its text
    // selected, so the keyboard can immediately retitle it.
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
    onProjectCreated()
    onCloseMobileMenu()
    router.push(createdId
      ? `/app/projects?rename=${encodeURIComponent(createdId)}`
      : '/app/projects')
    return true
  }, [onCloseMobileMenu, onProjectCreated, requireAuth, router, user])

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
    if (action.actionKey === 'projects.create') return createProject()
    return startAutomationDraft()
  }, [
    createChat,
    createNote,
    createProject,
    requireAuth,
    startAutomationDraft,
    user,
  ])

  return {
    createChat,
    runSidebarAction,
  }
}
