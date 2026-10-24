import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationRuntime } from '../chat-interface/types'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { createNewChatForSend } from './chat-send-create'

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
      setRuntimeHydrationVersion: () => undefined,
      syncStandaloneChatUrl: () => undefined,
      startFirstMessageRename: () => undefined,
      tryActivatePendingFirstSend: () => undefined,
    })
    assert.equal(createInput?.scope, 'workspace')
  } finally {
    client.createResponse = originalCreateResponse
    if (originalWindow === undefined) delete (globalThis as typeof globalThis & { window?: Window }).window
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  }
})
