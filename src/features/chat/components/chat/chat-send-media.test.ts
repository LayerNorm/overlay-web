import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationUiState } from '@overlay/chat-core'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { ConversationRuntime } from '../chat-interface/types'
import { buildSubmittedComposerSnapshot } from './chat-send-body-builders'
import { sendMediaTurn } from './chat-send-media'

test('first media sends retain native personal title ownership before subscription rows arrive', async (t) => {
  t.mock.method(overlayAppClient.conversations, 'addMessageResponse', async () => new Response(null, { status: 204 }))
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  const runtime = () => ({
    askChats: [{ messages: [] }], actChat: { messages: [] }, hydrated: false, ui: createConversationUiState(),
  }) as unknown as ConversationRuntime
  const snapshot = buildSubmittedComposerSnapshot({
    selectedModels: ['model'], selectedActModel: 'model', activeChatTitle: null,
    selectedImageModels: ['image-model'], selectedVideoModels: [], attachedImages: [],
    pendingChatDocuments: [], mentions: [], isTemporaryChat: false, mode: 'chat',
    selectedToolIds: [], memoryEnabled: false, text: 'Draw a tree',
  })
  for (const scope of ['personal', 'workspace'] as const) {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { pathname: `/app/${scope}/chat`, search: '' } },
    })
    const target = runtime()
    const titleOwners: Array<boolean | undefined> = []
    const modifiedOwners: Array<boolean | undefined> = []
    const noop = () => undefined
    await sendMediaTurn({
      activeChatId: null, activeChatIdRef: { current: null }, applyUiStateToView: noop,
      completeSession: noop,
      createNewChat: async (options) => {
        options?.prepareRuntime?.({ chatId: 'new-chat', runtime: target, selectedModels: ['image-model'], selectedActModel: 'model' })
        return 'new-chat'
      },
      effectiveGenType: 'image', emptyRuntime: runtime(), ensureConversationRuntime: () => target,
      isSendBlocked: true, isFirstMessage: true, isTemporaryChatRef: { current: false },
      loadChats: async () => {}, loadSubscription: async () => {}, nativePersonalEnabled: true,
      markChatModified: (_id, _title, nativeOwner) => { modifiedOwners.push(nativeOwner) },
      pendingScrollChatIdRef: { current: null }, pendingScrollTurnIdRef: { current: null },
      replyContext: null, selectedActModel: 'model', setGenerationChip: noop,
      setIsFirstMessage: noop, setRuntimeHydrationVersion: noop, snapshot,
      startFirstMessageRename: (_id, _seed, nativeOwner) => { titleOwners.push(nativeOwner) },
      startSession: noop, updateRuntimeUiState: noop, videoSubMode: 'text-to-video',
    })
    assert.deepEqual(titleOwners, [scope === 'personal'])
    assert.deepEqual(modifiedOwners, [scope === 'personal'])
  }
})
