'use client'

/* eslint-disable react-hooks/refs */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chat, useChat } from '@/components/providers/ai-chat-client'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { createConversationUiState } from '@overlay/chat-core'
import { createDirectChatTransport } from '@/shared/chat/direct-chat-transport'
import type { ConversationRuntime, ConversationUiState } from '../chat-interface/types'
import { buildActStreamIdempotencyKey } from '@/shared/api/act-idempotency'
import { removeTransientGeneratedUiPreviews } from './generated-ui-mutation'

// Coalesce streamed message-state updates to ~15fps (66ms). The underlying Chat store
// still receives every token immediately; this only throttles how often `useChat`
// pushes new state into React, which is what drives the message-list re-render.
const STREAM_THROTTLE_MS = 66

function createConversationRuntime(
  chatId: string,
  uiOverrides: Partial<ConversationUiState> = {},
): ConversationRuntime {
  const actTransport = '/api/v1/conversations/act'
  const transport = () => createDirectChatTransport({
    api: actTransport,
    prepareSendMessagesRequest: ({ api, id, messages, body, headers, credentials, trigger, messageId }) => {
      const bodyRecord = (body ?? {}) as Record<string, unknown>
      const turnId = typeof bodyRecord.turnId === 'string' ? bodyRecord.turnId.trim() : ''
      const includeFullHistory = bodyRecord.temporaryChat === true
      const slotIndex = 0

      const nextHeaders = new Headers(headers)
      if (!nextHeaders.has('x-request-id')) {
        nextHeaders.set('x-request-id', crypto.randomUUID())
      }
      if (turnId) {
        nextHeaders.set('Idempotency-Key', buildActStreamIdempotencyKey(turnId, slotIndex))
      }

      return {
        api,
        headers: nextHeaders,
        credentials: credentials ?? 'same-origin',
        body: {
          ...body,
          id,
          messages: includeFullHistory ? messages : (messages.at(-1) ? [messages.at(-1)] : []),
          trigger,
          messageId,
        },
      }
    },
  })
  const askChats: ConversationRuntime['askChats'] = [
    new Chat({
      id: `${chatId}:ask`,
      transport: transport(),
    }),
  ]
  let actChat: Chat<UIMessage> | undefined
  const clearPreviews = () => {
    if (!actChat) return
    const messages = actChat.messages as UIMessage[]
    const next = removeTransientGeneratedUiPreviews(messages)
    if (next !== messages) actChat.messages = next as never
  }

  return {
    askChats,
    actChat: actChat = new Chat({
      id: `${chatId}:act`,
      transport: transport(),
      onError: clearPreviews,
      onFinish: ({ messages }) => {
        const settled = removeTransientGeneratedUiPreviews(messages as UIMessage[])
        if (actChat && settled !== messages) actChat.messages = settled as never
        askChats[0].messages = [...settled] as UIMessage[]
      },
    }),
    hydrated: false,
    ui: createConversationUiState(uiOverrides),
    nativePendingTurns: new Map(),
  }
}

export function useChatRuntimes(activeChatId: string | null) {
  const runtimesRef = useRef(new Map<string, ConversationRuntime>())
  const [emptyRuntime] = useState(() => createConversationRuntime('__empty__'))
  const emptyRuntimeRef = useRef(emptyRuntime)

  const ensureConversationRuntime = useCallback((chatId: string, uiOverrides?: Partial<ConversationUiState>) => {
    const existing = runtimesRef.current.get(chatId)
    if (existing) {
      if (uiOverrides) {
        existing.ui = createConversationUiState({
          ...existing.ui,
          ...uiOverrides,
          generationResults: uiOverrides.generationResults ?? existing.ui.generationResults,
        })
      }
      return existing
    }

    const runtime = createConversationRuntime(chatId, uiOverrides)
    runtimesRef.current.set(chatId, runtime)
    return runtime
  }, [])

  const replaceConversationRuntime = useCallback((
    chatId: string,
    uiSnapshot: ConversationUiState,
    askMessages: UIMessage[][],
    actMessages: UIMessage[],
    nativePendingTurns?: ConversationRuntime['nativePendingTurns'],
  ) => {
    const runtime = createConversationRuntime(chatId, uiSnapshot)
    runtime.askChats[0].messages = (askMessages[0] ?? []) as never
    runtime.actChat.messages = actMessages as never
    runtime.nativePendingTurns = new Map(nativePendingTurns ?? [])
    runtimesRef.current.delete(chatId)
    runtimesRef.current.set(chatId, runtime)
    return runtime
  }, [])

  const activeRuntime = activeChatId ? ensureConversationRuntime(activeChatId) : emptyRuntimeRef.current
  // Throttle streamed UI state updates so re-renders are coalesced to ~15fps instead of
  // firing on every token. Tokens still accumulate at full speed in the underlying Chat
  // store; only how often React re-renders the message list is capped. This is the main
  // lever that keeps long conversations responsive during streaming.
  const chat0 = useChat({ chat: activeRuntime.askChats[0], throttle: STREAM_THROTTLE_MS })
  const actChat = useChat({ chat: activeRuntime.actChat, throttle: STREAM_THROTTLE_MS })
  const chat0Ref = useRef(chat0)
  const actChatRef = useRef(actChat)
  useEffect(() => {
    chat0Ref.current = chat0
    actChatRef.current = actChat
  })
  useEffect(() => {
    if (actChat.status !== 'ready' && actChat.status !== 'error') return
    const messages = activeRuntime.actChat.messages as UIMessage[]
    const next = removeTransientGeneratedUiPreviews(messages)
    if (next !== messages) activeRuntime.actChat.messages = next as never
  }, [activeRuntime, actChat.status])
  const chatInstances = useMemo(() => [chat0], [chat0])

  return {
    runtimesRef,
    emptyRuntimeRef,
    ensureConversationRuntime,
    replaceConversationRuntime,
    activeRuntime,
    chat0,
    actChat,
    chat0Ref,
    actChatRef,
    chatInstances,
  }
}
