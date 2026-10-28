import assert from 'node:assert/strict'
import test from 'node:test'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { ConversationRuntime } from '../chat-interface/types'
import { isConversationScopeVerified } from '../conversationScopeVerification'
import { prefetchTitle } from '@/features/chat/lib/generate-title'
import { createNewChatForSend } from './chat-send-create'
import type { PendingFirstSendState } from './chat-send-pending-first'

test('deferred first-chat creation exposes the real id to the run lifecycle', async (t) => {
  const createResponse = t.mock.method(
    overlayAppClient.conversations,
    'createResponse',
    async () => new Response(JSON.stringify({ id: 'chat-real' }), { status: 201 }),
  )
  t.mock.method(
    overlayAppClient.chat,
    'generateTitleResponse',
    async () => new Response(JSON.stringify({ title: 'Generated first-message title' }), { status: 200 }),
  )
  const previousWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { setTimeout: () => 1 },
  })
  try {
    assert.equal(await prefetchTitle('seed with resolved title'), 'Generated first-message title')
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
  }
  const pending: PendingFirstSendState = {
    conversationClientId: 'client-1',
    previewRuntime: {} as ConversationRuntime,
    streamDone: false,
    realChatId: null,
    wasFirst: true,
    renameStarted: false,
    renameSeed: 'seed with resolved title',
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
  assert.equal(isConversationScopeVerified('personal:chat-real'), true)
  assert.equal(pending.realChatId, 'chat-real')
  assert.deepEqual(pendingRunConversationIds, ['chat-real'])
  assert.equal(createResponse.mock.calls[0]?.arguments[0].title, 'Generated first-message title')
  assert.equal(createResponse.mock.callCount(), 1)
})

test('new chat creation follows Workspace path scope over conflicting view query', async () => {
  const originalWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { pathname: '/w/acme/workspace/chat', search: '?view=personal' },
      dispatchEvent: () => true,
    },
  })
  const client = overlayAppClient.conversations
  const originalCreateResponse = client.createResponse
  let createInput: Parameters<typeof originalCreateResponse>[0] | undefined
  client.createResponse = (async (input) => {
    createInput = input
    return new Response(JSON.stringify({ id: 'chat-created' }), { status: 201 })
  }) as typeof originalCreateResponse
  try {
    await createNewChatForSend({
      activeChatIdRef: { current: null },
      applyUiStateToView: () => undefined,
      clearTransientComposerState: () => undefined,
      emptyRuntime: {} as ConversationRuntime,
      ensureConversationRuntime: () => ({} as ConversationRuntime),
      invalidateLoadChatRequest: () => undefined,
      mode: 'chat',
      options: { deferActivation: true },
      pendingFirstSendRef: { current: null },
      pendingScrollChatIdRef: { current: null },
      pendingScrollTurnIdRef: { current: null },
      persistActiveRuntimeUiState: () => undefined,
      resetComposerToolIds: () => undefined,
      selectedActModel: 'model',
      selectedModels: ['model'],
      setActiveChatId: () => undefined,
      setActiveViewer: () => undefined,
      setChats: () => undefined,
      setInterruptedExchangeIdx: () => undefined,
      setIsTemporaryChat: () => undefined,
      setPendingRunConversationId: () => undefined,
      setRuntimeHydrationVersion: () => undefined,
      syncStandaloneChatUrl: () => undefined,
      startFirstMessageRename: () => undefined,
      tryActivatePendingFirstSend: () => undefined,
    })
    assert.equal(createInput?.scope, 'workspace')
    assert.equal(isConversationScopeVerified('workspace:chat-created'), true)
  } finally {
    client.createResponse = originalCreateResponse
    if (originalWindow === undefined) delete (globalThis as typeof globalThis & { window?: Window }).window
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  }
})
