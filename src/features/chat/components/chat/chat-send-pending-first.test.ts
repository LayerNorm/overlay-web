import assert from 'node:assert/strict'
import test from 'node:test'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { createConversationUiState } from '@overlay/chat-core'
import type { ConversationRuntime, ConversationUiState } from '../chat-interface/types'
import {
  activatePendingFirstSend,
  completeSessionForPendingFirstSend,
  isStreamChatActive,
  startPendingFirstSendRename,
  type PendingFirstSendState,
} from './chat-send-pending-first'
import { PENDING_FIRST_CHAT_ID, TEMPORARY_CHAT_ID } from './chat-send-body-builders'

function message(id: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text: id }] } as UIMessage
}

function chat(messages: UIMessage[] = []) {
  return {
    messages,
    setMessages() {},
    stop() {},
  } as never
}

function runtimeFor(ui: Partial<ConversationUiState> = {}): ConversationRuntime {
  return {
    askChats: [
      chat([message('turn-1')]),
      chat([]),
      chat([]),
      chat([]),
    ],
    actChat: chat([message('turn-1')]),
    hydrated: true,
    ui: createConversationUiState(ui),
  }
}

test('checks active stream ids for temporary, pending-first, and persisted chats', () => {
  const activeChatIdRef = { current: 'chat-1' }
  const isTemporaryChatRef = { current: true }
  const pendingFirstSendRef = {
    current: {
      conversationClientId: 'client-1',
      previewRuntime: runtimeFor(),
      streamDone: false,
      realChatId: null,
      wasFirst: true,
      renameStarted: false,
      renameSeed: 'hello',
      activeChatTitleSnapshot: null,
    },
  }

  assert.equal(isStreamChatActive({
    activeChatIdRef,
    chatId: TEMPORARY_CHAT_ID,
    isTemporaryChatRef,
    pendingFirstSendRef,
    temporaryChatSnapshot: true,
  }), true)
  assert.equal(isStreamChatActive({
    activeChatIdRef,
    chatId: PENDING_FIRST_CHAT_ID,
    isTemporaryChatRef,
    pendingFirstSendRef,
    temporaryChatSnapshot: false,
  }), true)
  assert.equal(isStreamChatActive({
    activeChatIdRef,
    chatId: 'chat-1',
    isTemporaryChatRef,
    pendingFirstSendRef,
    temporaryChatSnapshot: false,
  }), true)
})

test('activates pending first send once real chat and stream completion are both ready', () => {
  const previewRuntime = runtimeFor({
    activeChatTitle: 'Preview',
    isFirstMessage: false,
  })
  const emptyRuntime = runtimeFor({ activeChatTitle: 'Empty' })
  const pendingFirstSendRef: { current: PendingFirstSendState | null } = {
    current: {
      conversationClientId: 'client-1',
      previewRuntime,
      streamDone: true,
      realChatId: 'chat-real',
      wasFirst: true,
      renameStarted: false,
      renameSeed: 'hello world',
      activeChatTitleSnapshot: 'Preview',
    },
  }

  const replaced: Array<{
    chatId: string
    askMessages: UIMessage[][]
    actMessages: UIMessage[]
  }> = []
  const marked: Array<[string, string | null | undefined]> = []
  const renamed: Array<[string, string]> = []
  let activeViewer: string | null = null
  let activeChat: string | null = null
  let routeChat: string | null = null
  const appliedUi: ConversationUiState[] = []
  let hydrationBumps = 0
  const activeChatIdRef = { current: null as string | null }

  activatePendingFirstSend({
    activeChatIdRef,
    applyUiStateToView: (ui) => { appliedUi.push(ui) },
    emptyRuntime,
    markChatModified: (chatId, title) => marked.push([chatId, title]),
    pendingFirstSendRef,
    replaceConversationRuntime: (chatId, uiSnapshot, askMessages, actMessages) => {
      replaced.push({ chatId, askMessages, actMessages })
      return runtimeFor(uiSnapshot)
    },
    setActiveChatId: (chatId) => { activeChat = chatId },
    setActiveViewer: (chatId) => { activeViewer = chatId },
    setRuntimeHydrationVersion: (updater) => {
      hydrationBumps = typeof updater === 'function' ? updater(hydrationBumps) : updater
    },
    startFirstMessageRename: (chatId, seed) => renamed.push([chatId, seed]),
    syncStandaloneChatUrl: (chatId) => { routeChat = chatId },
  })

  assert.equal(replaced.length, 1)
  const replacedValue = replaced[0]!
  assert.equal(replacedValue.chatId, 'chat-real')
  assert.equal(replacedValue.askMessages[0]?.[0]?.id, 'turn-1')
  assert.equal(replacedValue.actMessages[0]?.id, 'turn-1')
  assert.deepEqual(marked, [['chat-real', 'Preview']])
  assert.deepEqual(renamed, [['chat-real', 'hello world']])
  assert.equal(activeChatIdRef.current, 'chat-real')
  assert.equal(activeViewer, 'chat-real')
  assert.equal(activeChat, 'chat-real')
  assert.equal(routeChat, 'chat-real')
  assert.equal(appliedUi[0]?.activeChatTitle, 'Preview')
  assert.equal(emptyRuntime.askChats[0].messages.length, 0)
  assert.equal(pendingFirstSendRef.current, null)
  assert.equal(hydrationBumps, 1)
})

test('completeSessionForPendingFirstSend defers chat creation until real id exists', () => {
  const pendingFirstSendRef: { current: PendingFirstSendState | null } = {
    current: {
      conversationClientId: 'client-1',
      previewRuntime: runtimeFor(),
      streamDone: false,
      realChatId: null,
      wasFirst: true,
      renameStarted: false,
      renameSeed: 'hello',
      activeChatTitleSnapshot: null,
    },
  }
  let completed: [string, boolean] | null = null
  let deferredClientId: string | null = null
  let activated = 0

  completeSessionForPendingFirstSend({
    completeSession: (chatId, active) => { completed = [chatId, active] },
    createDeferredChat: (clientId) => { deferredClientId = clientId },
    pendingFirstSendRef,
    tryActivatePendingFirstSend: () => { activated += 1 },
  })

  assert.equal(pendingFirstSendRef.current?.streamDone, true)
  assert.equal(deferredClientId, 'client-1')
  assert.deepEqual(completed, [PENDING_FIRST_CHAT_ID, true])
  assert.equal(activated, 1)
})

test('starts the first-message rename as soon as the persisted id arrives and only once', () => {
  const pending: PendingFirstSendState = {
    conversationClientId: 'client-1',
    previewRuntime: runtimeFor(),
    streamDone: false,
    realChatId: 'chat-real',
    wasFirst: true,
    renameStarted: false,
    renameSeed: 'sidebar title now',
    activeChatTitleSnapshot: null,
  }
  const renamed: Array<[string, string]> = []

  startPendingFirstSendRename(pending, (chatId, seed) => renamed.push([chatId, seed]))
  startPendingFirstSendRename(pending, (chatId, seed) => renamed.push([chatId, seed]))

  assert.deepEqual(renamed, [['chat-real', 'sidebar title now']])
  assert.equal(pending.renameStarted, true)
})
