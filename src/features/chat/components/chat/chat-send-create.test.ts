import assert from 'node:assert/strict'
import test from 'node:test'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { ConversationRuntime } from '../chat-interface/types'
import { createNewChatForSend } from './chat-send-create'
import type { PendingFirstSendState } from './chat-send-pending-first'

test('deferred first-chat creation exposes the real id to the run lifecycle', async (t) => {
  const createResponse = t.mock.method(
    overlayAppClient.conversations,
    'createResponse',
    async () => new Response(JSON.stringify({ id: 'chat-real' }), { status: 201 }),
  )
  const pending: PendingFirstSendState = {
    conversationClientId: 'client-1',
    previewRuntime: {} as ConversationRuntime,
    streamDone: false,
    realChatId: null,
    wasFirst: true,
    renameStarted: false,
    renameSeed: 'hello',
    activeChatTitleSnapshot: null,
  }
  const pendingFirstSendRef = { current: pending }
  const pendingRunConversationIds: Array<string | null> = []

  const chatId = await createNewChatForSend({
    activeChatIdRef: { current: null },
    applyUiStateToView: () => {},
    clearTransientComposerState: () => {},
    emptyRuntime: {} as ConversationRuntime,
    ensureConversationRuntime: () => ({} as ConversationRuntime),
    invalidateLoadChatRequest: () => {},
    mode: 'chat',
    options: { clientId: 'client-1', deferActivation: true },
    pendingFirstSendRef,
    pendingScrollChatIdRef: { current: null },
    pendingScrollTurnIdRef: { current: null },
    persistActiveRuntimeUiState: () => {},
    resetComposerToolIds: () => {},
    selectedActModel: 'test-model',
    selectedModels: ['test-model'],
    setActiveChatId: () => {},
    setActiveViewer: () => {},
    setChats: () => {},
    setInterruptedExchangeIdx: () => {},
    setIsTemporaryChat: () => {},
    setPendingRunConversationId: (id) => { pendingRunConversationIds.push(id) },
    setRuntimeHydrationVersion: () => {},
    syncStandaloneChatUrl: () => {},
    startFirstMessageRename: () => {},
    tryActivatePendingFirstSend: () => {},
  })

  assert.equal(chatId, 'chat-real')
  assert.equal(pending.realChatId, 'chat-real')
  assert.deepEqual(pendingRunConversationIds, ['chat-real'])
  assert.equal(createResponse.mock.callCount(), 1)
})
