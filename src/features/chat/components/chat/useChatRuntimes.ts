'use client'

/* eslint-disable react-hooks/refs */

import { useCallback, useMemo, useRef } from 'react'
import { Chat, useChat } from '@/components/providers/ai-chat-client'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { createConversationUiState } from '@overlay/chat-core'
import {
  createPersistentChatTransport,
  getCloudflareChatStreamRelayApi,
} from '@/shared/chat/cloudflare-chat-transport'
import type { ConversationRuntime, ConversationUiState } from '../chat-interface/types'
import { buildActStreamIdempotencyKey } from '@/shared/api/act-idempotency'

// Coalesce streamed message-state updates to ~15fps (66ms). The underlying Chat store
// still receives every token immediately; this only throttles how often `useChat`
// pushes new state into React, which is what drives the message-list re-render.
const STREAM_THROTTLE_MS = 66

function createConversationRuntime(
  chatId: string,
  uiOverrides: Partial<ConversationUiState> = {},
): ConversationRuntime {
  const actTransport = '/api/v1/conversations/act'
  const transport = () => createPersistentChatTransport({
    api: actTransport,
    prepareSendMessagesRequest: ({ api, id, messages, body, headers, credentials, trigger, messageId }) => {
      const bodyRecord = (body ?? {}) as Record<string, unknown>
      const turnId = typeof bodyRecord.turnId === 'string' ? bodyRecord.turnId.trim() : ''
      const includeFullHistory = bodyRecord.temporaryChat === true
      const streamPersistenceMode = includeFullHistory ? 'direct' : bodyRecord.streamPersistenceMode
      const slotFromBody = bodyRecord.multiModelSlotIndex ?? bodyRecord.variantIndex
      let slotIndex = typeof slotFromBody === 'number' && Number.isFinite(slotFromBody)
        ? slotFromBody
        : 0
      const askSlotMatch = /:ask:(\d+)$/.exec(id)
      if (askSlotMatch) {
        slotIndex = Number(askSlotMatch[1])
      }

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
          streamPersistenceMode,
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
      id: `${chatId}:ask:0`,
      transport: transport(),
    }),
    new Chat({
      id: `${chatId}:ask:1`,
      transport: transport(),
    }),
    new Chat({
      id: `${chatId}:ask:2`,
      transport: transport(),
    }),
    new Chat({
      id: `${chatId}:ask:3`,
      transport: transport(),
    }),
  ]

  return {
    askChats,
    actChat: new Chat({
      id: `${chatId}:act`,
      transport: transport(),
      onFinish: ({ messages }) => {
        askChats[0].messages = [...messages] as UIMessage[]
      },
    }),
    hydrated: false,
    ui: createConversationUiState(uiOverrides),
  }
}

export function useChatRuntimes(activeChatId: string | null) {
  const runtimesRef = useRef(new Map<string, ConversationRuntime>())
  const emptyRuntimeRef = useRef(createConversationRuntime('__empty__'))

  const ensureConversationRuntime = useCallback((chatId: string, uiOverrides?: Partial<ConversationUiState>) => {
    const existing = runtimesRef.current.get(chatId)
    if (existing) {
      if (uiOverrides) {
        existing.ui = createConversationUiState({
          ...existing.ui,
          ...uiOverrides,
          generationResults: uiOverrides.generationResults ?? existing.ui.generationResults,
          orphanModelThreads: uiOverrides.orphanModelThreads ?? existing.ui.orphanModelThreads,
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
  ) => {
    const runtime = createConversationRuntime(chatId, uiSnapshot)
    runtime.askChats.forEach((chat, index) => {
      if (askMessages[index]) chat.messages = askMessages[index] as never
    })
    runtime.actChat.messages = actMessages as never
    runtimesRef.current.delete(chatId)
    runtimesRef.current.set(chatId, runtime)
    return runtime
  }, [])

  const activeRuntime = activeChatId ? ensureConversationRuntime(activeChatId) : emptyRuntimeRef.current
  const chatStreamRelayApi = getCloudflareChatStreamRelayApi()
  // Throttle streamed UI state updates so re-renders are coalesced to ~15fps instead of
  // firing on every token. Tokens still accumulate at full speed in the underlying Chat
  // store; only how often React re-renders the message list is capped. This is the main
  // lever that keeps long conversations responsive during streaming.
  const chat0 = useChat({ chat: activeRuntime.askChats[0], throttle: STREAM_THROTTLE_MS })
  const chat1 = useChat({ chat: activeRuntime.askChats[1], throttle: STREAM_THROTTLE_MS })
  const chat2 = useChat({ chat: activeRuntime.askChats[2], throttle: STREAM_THROTTLE_MS })
  const chat3 = useChat({ chat: activeRuntime.askChats[3], throttle: STREAM_THROTTLE_MS })
  const actChat = useChat({ chat: activeRuntime.actChat, throttle: STREAM_THROTTLE_MS })
  const chat0Ref = useRef(chat0)
  const chat1Ref = useRef(chat1)
  const chat2Ref = useRef(chat2)
  const chat3Ref = useRef(chat3)
  const actChatRef = useRef(actChat)
  chat0Ref.current = chat0
  chat1Ref.current = chat1
  chat2Ref.current = chat2
  chat3Ref.current = chat3
  actChatRef.current = actChat
  const chatInstances = useMemo(() => [chat0, chat1, chat2, chat3], [chat0, chat1, chat2, chat3])

  return {
    runtimesRef,
    emptyRuntimeRef,
    ensureConversationRuntime,
    replaceConversationRuntime,
    activeRuntime,
    chatStreamRelayApi,
    chat0,
    chat1,
    chat2,
    chat3,
    actChat,
    chat0Ref,
    chat1Ref,
    chat2Ref,
    chat3Ref,
    actChatRef,
    chatInstances,
  }
}
