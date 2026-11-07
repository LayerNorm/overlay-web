import assert from 'node:assert/strict'
import test from 'node:test'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { ConversationRuntime } from '../chat-interface/types'
import { isConversationScopeVerified } from '../conversationScopeVerification'
import { prefetchTitle } from '@/features/chat/lib/generate-title'
import { createNewChatForSend } from './chat-send-create'
import type { PendingFirstSendState } from './chat-send-pending-first'

test('deferred first-chat creation exposes the real id to the run lifecycle', async (t) => {
  const created: Array<{ title: string; scope: string }> = []
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
    isCurrentScope: () => true,
    mode: 'chat',
    nativePersonalEnabled: true,
    nativePersonalRoute: true,
    workspaceId: 'workspace',
    createNativePersonalChat: async (args) => {
      created.push({ title: args.title, scope: args.scope })
      return 'chat-real'
    },
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
  assert.deepEqual(created, [{ title: 'Generated first-message title', scope: 'personal' }])
})

test('a native first turn publishes its durable URL before the stream finishes', async () => {
  const pending: PendingFirstSendState = {
    conversationClientId: 'client-native',
    previewRuntime: {} as ConversationRuntime,
    streamDone: false,
    realChatId: null,
    wasFirst: true,
    renameStarted: false,
    renameSeed: 'seed',
    activeChatTitleSnapshot: null,
  }
  const urls: Array<string | null> = []
  let activationAttempts = 0
  await createNewChatForSend({
    activeChatIdRef: { current: null },
    applyUiStateToView: () => {},
    clearTransientComposerState: () => {},
    emptyRuntime: {} as ConversationRuntime,
    ensureConversationRuntime: () => ({} as ConversationRuntime),
    invalidateLoadChatRequest: () => {},
    isCurrentScope: () => true,
    mode: 'chat',
    nativePersonalEnabled: true,
    nativePersonalRoute: true,
    options: { clientId: 'client-native', deferActivation: true, persistedChatId: 'chat-native' },
    pendingFirstSendRef: { current: pending },
    pendingScrollChatIdRef: { current: null },
    pendingScrollTurnIdRef: { current: null },
    persistActiveRuntimeUiState: () => {},
    resetComposerToolIds: () => {},
    selectedActModel: 'test-model',
    selectedModels: ['test-model'],
    setActiveChatId: () => {},
    setActiveViewer: () => {},
    setInterruptedExchangeIdx: () => {},
    setIsTemporaryChat: () => {},
    setPendingRunConversationId: () => {},
    setRuntimeHydrationVersion: () => {},
    syncStandaloneChatUrl: (id) => { urls.push(id) },
    startFirstMessageRename: () => {},
    tryActivatePendingFirstSend: () => { activationAttempts += 1 },
  })
  assert.deepEqual(urls, ['chat-native'])
  assert.equal(pending.realChatId, 'chat-native')
  assert.equal(pending.streamDone, false)
  assert.equal(activationAttempts, 1)
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
  let createdScope: string | undefined
  try {
    await createNewChatForSend({
      activeChatIdRef: { current: null },
      applyUiStateToView: () => undefined,
      clearTransientComposerState: () => undefined,
      emptyRuntime: {} as ConversationRuntime,
      ensureConversationRuntime: () => ({} as ConversationRuntime),
      invalidateLoadChatRequest: () => undefined,
      isCurrentScope: () => true,
      mode: 'chat',
      nativePersonalEnabled: true,
      nativePersonalRoute: true,
      workspaceId: 'workspace',
      createNativePersonalChat: async (args) => {
        createdScope = args.scope
        return 'chat-created'
      },
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
      setInterruptedExchangeIdx: () => undefined,
      setIsTemporaryChat: () => undefined,
      setPendingRunConversationId: () => undefined,
      setRuntimeHydrationVersion: () => undefined,
      syncStandaloneChatUrl: () => undefined,
      startFirstMessageRename: () => undefined,
      tryActivatePendingFirstSend: () => undefined,
    })
    assert.equal(createdScope, 'workspace')
    assert.equal(isConversationScopeVerified('workspace:chat-created'), true)
  } finally {
    if (originalWindow === undefined) delete (globalThis as typeof globalThis & { window?: Window }).window
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  }
})
