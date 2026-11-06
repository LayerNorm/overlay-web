'use client'

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { useRouter } from 'next/navigation'
import { toast } from '@overlay/ui/primitives'
import { announceArchived } from '@/shared/app/archive-toast'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { useRoomApi, useRoomEvents } from './room-state-adapters'
import { useNativeRoomMetadata } from './NativeRoomState'

export function useRoomLifecycle({
  conversationId,
  convexRoomSubscriptionEnabled,

  loadParticipants,
  loadMessages,
  loadCollaboration,
  loadPresence,
  setLoading,
}: {
  conversationId: string
  convexRoomSubscriptionEnabled: boolean

  loadParticipants: () => Promise<void>
  loadMessages: () => Promise<void>
  loadCollaboration: () => Promise<void>
  loadPresence: () => Promise<void>
  setLoading: Dispatch<SetStateAction<boolean>>
}) {
  const api = useRoomApi(conversationId)
  const native = useNativeRoomMetadata()
  const heartbeat = native?.heartbeat
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {

    if (heartbeat) return
    let cancelled = false
    // When Convex realtime presence subscription is active, skip the initial
    // HTTP presence load — the subscription will deliver presence state.
    const skipPresencePolling = convexRoomSubscriptionEnabled
    const initialLoadTimer = window.setTimeout(() => {
      // Presence, reactions, pins, and saved state enrich a room, but must not
      // decide whether its critical transcript can open.
      void Promise.allSettled([
        skipPresencePolling ? Promise.resolve() : loadPresence(),
        loadCollaboration(),
      ])
      void Promise.all([loadParticipants(), loadMessages()])
        // A room can receive its transcript through the realtime transport
        // while one of these initial BFF reads is transiently unavailable.
        // Do not turn that recoverable race into a false access failure.
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 0)
    const sessionId = sessionIdRef.current ?? crypto.randomUUID()
    sessionIdRef.current = sessionId
    void api
      .updatePresence(conversationId, { status: 'online', sessionId })
      .catch(() => undefined)
    // Only poll presence via HTTP when Convex subscription is unavailable.
    const presenceTimer = skipPresencePolling
      ? undefined
      : window.setInterval(() => void loadPresence().catch(() => undefined), 15_000)
    const heartbeatTimer = window.setInterval(() => {
      void api
        .updatePresence(conversationId, { status: 'online', sessionId })
        .catch(() => undefined)
    }, 45_000)
    return () => {
      cancelled = true
      window.clearTimeout(initialLoadTimer)
      if (presenceTimer !== undefined) window.clearInterval(presenceTimer)
      window.clearInterval(heartbeatTimer)
      void api
        .updatePresence(conversationId, { status: 'offline', sessionId })
        .catch(() => undefined)
    }
  }, [api, conversationId, convexRoomSubscriptionEnabled, loadCollaboration, loadMessages, loadParticipants, loadPresence, setLoading, heartbeat])

  useEffect(() => {
    if (!heartbeat) return
    const sessionId = sessionIdRef.current ?? crypto.randomUUID()
    sessionIdRef.current = sessionId
    const send = (status: 'online' | 'offline') => void heartbeat({ sessionId, status }).catch(() => undefined)
    send('online')
    const timer = window.setInterval(() => send('online'), 45_000)
    return () => { window.clearInterval(timer); send('offline') }
  }, [heartbeat])
  return sessionIdRef
}

export function useRoomActions({
  conversationId,
  conversationType,

  title,
  activeWorkspaceId,
  router,
  otherParticipantsCount,
  currentParticipantArchived,
  loadParticipants,
  setMenuOpen,
}: {
  conversationId: string
  conversationType: 'dm' | 'channel'

  title: string
  activeWorkspaceId: string | null | undefined
  router: ReturnType<typeof useRouter>
  otherParticipantsCount: number
  currentParticipantArchived: boolean
  loadParticipants: () => Promise<void>
  setMenuOpen: Dispatch<SetStateAction<boolean>>
}) {
  const api = useRoomApi(conversationId)
  const events = useRoomEvents()
  const buildWorkspaceHref = useWorkspaceHref()
  const [pendingArchiveScope, setPendingArchiveScope] = useState(false)
  const [scopeDialogBusy, setScopeDialogBusy] = useState(false)
  const [scopeDialogError, setScopeDialogError] = useState<string | null>(null)
  const [pendingDeleteScope, setPendingDeleteScope] = useState(false)

  async function updateState(
    state: Parameters<typeof api.updateParticipantState>[1],
    confirmation: string,
  ) {

    try {
      await api.updateParticipantState(conversationId, state)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the conversation.')
      return false
    }
    toast.success(confirmation)
    setMenuOpen(false)
    await loadParticipants()
    return true
  }

  async function archiveConversation(scope: 'self' | 'everyone') {

    setScopeDialogBusy(true)
    setScopeDialogError(null)
    try {
      await api.updateParticipantState(conversationId, {
        archived: true,
        archiveScope: scope,
      })
      events.archived({
        chat: {
          _id: conversationId,
          title,
          lastModified: Date.now(),
          conversationType,
        },
      })
      announceArchived({
        name: title || 'Conversation',
        undo: async () => {
          await api.updateParticipantState(conversationId, { archived: false, archiveScope: scope })
        },
        onUndone: () => events.modified({ chat: { _id: conversationId, title, lastModified: Date.now(), conversationType } }),
      })
      setPendingArchiveScope(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Conversation could not be archived'
      if (pendingArchiveScope) setScopeDialogError(message)
      toast.error(message)
    } finally {
      setScopeDialogBusy(false)
    }
  }

  function archiveMenuAction() {
    setMenuOpen(false)
    if (currentParticipantArchived) {
      const ownsNavigation = events.navigationOwner()
      void updateState({ archived: false }, 'Conversation restored').then((updated) => {
        if (!updated || !ownsNavigation()) return
        const view = conversationType === 'channel' ? 'channels' : 'dms'
        router.push(buildWorkspaceHref(
          activeWorkspaceId ?? null,
          `/app/chat?${new URLSearchParams({ view, id: conversationId }).toString()}`,
          'workspace',
        ))
      }).catch(() => undefined)
      return
    }
    // A one-to-one DM has nobody else to keep it for — archive directly
    // instead of asking about scope.
    if (otherParticipantsCount <= 1) {
      void archiveConversation('self')
      return
    }
    setScopeDialogError(null)
    setPendingArchiveScope(true)
  }

  async function deleteConversation(scope: 'self' | 'everyone') {
    const ownsNavigation = events.navigationOwner()
    setScopeDialogBusy(true)
    setScopeDialogError(null)
    try {
      const response = await api.deleteResponse({
        conversationId,
        scope,
      })
      if (!response.ok) throw new Error('Conversation was not deleted')
      events.archived({
        chat: {
          _id: conversationId,
          title,
          lastModified: Date.now(),
          conversationType,
          archivedAt: Date.now(),
        },
      })
      setPendingDeleteScope(false)
      if (!ownsNavigation()) return
      const view = conversationType === 'channel' ? 'channels' : 'dms'
      router.push(buildWorkspaceHref(
        activeWorkspaceId ?? null,
        `/app/chat?${new URLSearchParams({ view }).toString()}`,
        'workspace',
      ))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Conversation could not be deleted'
      setScopeDialogError(message)
      toast.error(message)
    } finally {
      setScopeDialogBusy(false)
    }
  }

  return {
    pendingArchiveScope,
    setPendingArchiveScope,
    scopeDialogBusy,
    scopeDialogError,
    pendingDeleteScope,
    setPendingDeleteScope,
    updateState,
    archiveConversation,
    archiveMenuAction,
    deleteConversation,
  }
}
