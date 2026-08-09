'use client'

import { useEffect, useRef } from 'react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  conversationEventRetryDelayMs,
  LOCAL_STREAM_RECONCILIATION_GRACE_MS,
  shouldReloadActiveConversation,
} from '@/shared/chat/postgres-conversation-event-policy'

type ConversationEvent = {
  sequence: number
  conversationId: string
  type: string
}

type ConversationEventResponse = {
  cursor: number
  events: ConversationEvent[]
}

export function usePostgresConversationEvents({
  activeChatIdRef,
  enabled,
  hasActiveLocalStream,
  loadChats,
  onEvents,
  onRemoteStop,
  reloadActiveConversation,
}: {
  activeChatIdRef: { current: string | null }
  enabled: boolean
  hasActiveLocalStream: () => boolean
  loadChats: () => Promise<void>
  onEvents?: (events: ConversationEvent[]) => void
  onRemoteStop: () => void
  reloadActiveConversation: (chatId: string) => Promise<void>
}) {
  const callbacksRef = useRef({ hasActiveLocalStream, loadChats, onEvents, onRemoteStop, reloadActiveConversation })
  callbacksRef.current = { hasActiveLocalStream, loadChats, onEvents, onRemoteStop, reloadActiveConversation }

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let stopped = false
    let cursor: number | undefined
    let activeReloadTimer: ReturnType<typeof setTimeout> | undefined
    let listReloadTimer: ReturnType<typeof setTimeout> | undefined
    let activeReloadInFlight = false
    let activeReloadQueued = false
    let activeReloadQueuedEventTypes: string[] = []
    let localStreamGraceUntil = 0
    let consecutiveFailures = 0

    const scheduleListReload = () => {
      if (listReloadTimer) return
      listReloadTimer = setTimeout(() => {
        listReloadTimer = undefined
        void callbacksRef.current.loadChats()
      }, 300)
    }

    const scheduleActiveReload = (chatId: string, eventTypes: string[]) => {
      if (callbacksRef.current.hasActiveLocalStream()) {
        localStreamGraceUntil = Date.now() + LOCAL_STREAM_RECONCILIATION_GRACE_MS
        return
      }
      if (!shouldReloadActiveConversation({
        eventTypes,
        localStreamGraceUntil,
        now: Date.now(),
      })) return
      if (activeReloadInFlight) {
        activeReloadQueued = true
        activeReloadQueuedEventTypes.push(...eventTypes)
        return
      }
      if (activeReloadTimer) clearTimeout(activeReloadTimer)
      activeReloadTimer = setTimeout(() => {
        activeReloadTimer = undefined
        if (activeChatIdRef.current !== chatId) return
        if (callbacksRef.current.hasActiveLocalStream()) {
          localStreamGraceUntil = Date.now() + LOCAL_STREAM_RECONCILIATION_GRACE_MS
          return
        }
        if (!shouldReloadActiveConversation({
          eventTypes,
          localStreamGraceUntil,
          now: Date.now(),
        })) return
        activeReloadInFlight = true
        void callbacksRef.current.reloadActiveConversation(chatId).finally(() => {
          activeReloadInFlight = false
          if (!activeReloadQueued) return
          activeReloadQueued = false
          const queuedEventTypes = activeReloadQueuedEventTypes
          activeReloadQueuedEventTypes = []
          scheduleActiveReload(chatId, queuedEventTypes)
        })
      }, 200)
    }

    const consume = async () => {
      while (!stopped) {
        let retryAfterSeconds: number | undefined
        try {
          const httpResponse = await overlayAppClient.conversations.eventsResponse(cursor, {
            cache: 'no-store',
            credentials: 'same-origin',
            signal: controller.signal,
          })
          if (!httpResponse.ok) {
            const retryAfter = Number(httpResponse.headers.get('Retry-After'))
            retryAfterSeconds = Number.isFinite(retryAfter) ? retryAfter : undefined
            throw new Error(`Conversation event poll failed with HTTP ${httpResponse.status}`)
          }
          const response = await httpResponse.json() as ConversationEventResponse
          if (!Number.isSafeInteger(response.cursor) || !Array.isArray(response.events)) {
            throw new Error('Conversation event poll returned an invalid payload')
          }
          if (stopped) return
          consecutiveFailures = 0
          cursor = response.cursor
          callbacksRef.current.onEvents?.(response.events)
          if (response.events.length === 0) continue
          scheduleListReload()
          const activeChatId = activeChatIdRef.current
          const activeEvents = activeChatId
            ? response.events.filter((event) => event.conversationId === activeChatId)
            : []
          if (activeEvents.some((event) => event.type === 'message.stopped')) {
            callbacksRef.current.onRemoteStop()
          }
          if (activeChatId && activeEvents.length > 0) {
            scheduleActiveReload(activeChatId, activeEvents.map((event) => event.type))
          }
        } catch (error) {
          if (stopped || controller.signal.aborted) return
          consecutiveFailures += 1
          const retryDelayMs = conversationEventRetryDelayMs({
            attempt: consecutiveFailures,
            retryAfterSeconds,
          })
          console.warn('[chat-sync] Postgres conversation event poll failed; retrying', {
            error: error instanceof Error ? error.message : String(error),
            retryDelayMs,
          })
          await delay(retryDelayMs, controller.signal)
        }
      }
    }

    void consume()
    return () => {
      stopped = true
      controller.abort()
      if (activeReloadTimer) clearTimeout(activeReloadTimer)
      if (listReloadTimer) clearTimeout(listReloadTimer)
    }
  }, [activeChatIdRef, enabled])
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds)
    function finish() {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}
