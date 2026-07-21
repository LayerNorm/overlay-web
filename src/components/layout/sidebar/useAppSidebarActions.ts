'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  KNOWLEDGE_ENTITY_MUTATION_EVENT,
  createKnowledgeMutationPublisher,
  type OverlaySidebarAction,
  type OverlaySidebarActionKey,
} from '@overlay/app-core'
import { resolveNewChatModelFields } from '@/shared/chat/chat-model-prefs'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { dispatchChatCreated } from '@/shared/chat/chat-title'
import { markNewEmptyChat, upsertCachedChat } from '@/shared/chat/chat-list-cache'
import { createIdempotencyKey, toRequestInit } from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { GateReason } from '@/components/providers/GuestGateProvider'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'

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
  searchParams: URLSearchParams
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
  searchParams,
  isFreeTier = false,
  requireAuth,
  onCloseMobileMenu,
  onChatCreated,
  onProjectCreated,
}: UseAppSidebarActionsOptions) {
  const router = useRouter()
  const { settings } = useAppSettings()
  const { appDataCapabilities } = useOverlayCapabilities()

  const createChat = useCallback(async () => {
    if (!user) {
      requireAuth('send')
      return false
    }
    const models = resolveNewChatModelFields({
      defaultActModelId: settings.defaultActModelId,
      defaultAskModelIds: settings.defaultAskModelIds,
      isFreeTier,
      onlyAllowZdrModels: settings.onlyAllowZdrModels,
    })
    const res = await overlayAppClient.conversations.createResponse(
      {
        title: 'New Chat',
        askModelIds: models.askModelIds,
        actModelId: models.actModelId,
        lastMode: models.lastMode,
      },
      { idempotencyKey: createIdempotencyKey() },
    )
    if (!res.ok) return false
    const data = await res.json() as {
      id?: string
      conversation?: { _id: string; title: string; lastModified: number }
    }
    if (!data.id) return false
    const chat = {
      ...(data.conversation ?? { _id: data.id, title: 'New Chat', lastModified: 0 }),
      askModelIds: models.askModelIds,
      actModelId: models.actModelId,
      lastMode: models.lastMode,
    }
    upsertCachedChat(chat)
    markNewEmptyChat(chat)
    dispatchChatCreated({ chat })
    onChatCreated()
    onCloseMobileMenu()
    const href = `/app/chat?id=${encodeURIComponent(data.id)}`
    if (pathname === '/app/chat') {
      window.history.pushState(null, '', href)
      window.dispatchEvent(new CustomEvent('overlay:chat-route-selected', {
        detail: { chatId: data.id },
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
    isFreeTier,
    settings.defaultActModelId,
    settings.defaultAskModelIds,
    settings.onlyAllowZdrModels,
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
    if (appDataCapabilities.provider === 'postgres') {
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
      if (!data.id) return false
      publishCreatedNote(data.id)
      onCloseMobileMenu()
      router.push(`/app/notes?id=${encodeURIComponent(data.id)}`)
      return true
    }

    const parentId = pathname.startsWith('/app/files') ? searchParams.get('folder') : null
    const res = await overlayAppClient.files.createResponse(
      {
        kind: 'note',
        name: 'Untitled',
        textContent: '',
        parentId,
      },
      { idempotencyKey },
    )
    if (!res.ok) return false
    const data = await res.json() as {
      id?: string
      file?: {
        _id: string
        name?: string
        content?: string
        textContent?: string
        createdAt?: number
        updatedAt?: number
      }
    }
    if (!data.id) return false
    publishCreatedNote(data.id)
    onCloseMobileMenu()
    router.push(`/app/notes?id=${encodeURIComponent(data.id)}`)
    return true
  }, [appDataCapabilities.provider, onCloseMobileMenu, pathname, requireAuth, router, searchParams, user])

  const createProject = useCallback(async () => {
    if (!user) {
      requireAuth('nav')
      return false
    }
    const res = await overlayAppClient.projects.createResponse({ name: 'Untitled Project' })
    if (!res.ok) return false
    onProjectCreated()
    onCloseMobileMenu()
    router.push('/app/projects')
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
