import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationUiState } from '@overlay/chat-core'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { ConversationRuntime } from '../chat-interface/types'
import { buildSubmittedComposerSnapshot } from './chat-send-body-builders'
import { sendMediaTurn } from './chat-send-media'
import { startPendingFirstSendRename, type PendingFirstSendState } from './chat-send-pending-first'

function nativeMediaArgs(): Parameters<typeof sendMediaTurn>[0] {
  const noop = () => {}
  const runtime = { askChats: [{ messages: [] }], actChat: { messages: [] }, hydrated: false,
    ui: createConversationUiState() } as unknown as ConversationRuntime
  return {
    activeChatId: null, activeChatIdRef: { current: null }, applyUiStateToView: noop,
    completeSession: noop, completeSessionForStream: noop, createNewChat: async options => options!.persistedChatId!,
    effectiveGenType: 'image', emptyRuntime: runtime, ensureConversationRuntime: () => runtime,
    isSendBlocked: false, isFirstMessage: true, isTemporaryChatRef: { current: false },
    loadChats: async () => {}, loadSubscription: async () => {}, nativePersonalEnabled: true,
    nativePersonalRoute: true, nativeWorkspaceId: 'workspace', nativeOwnerId: 'owner',
    pendingFirstSendRef: { current: null }, isCurrentScope: () => true, isStreamChatActive: () => true,
    markChatModified: noop, pendingScrollChatIdRef: { current: null }, pendingScrollTurnIdRef: { current: null },
    replyContext: null, selectedActModel: 'model', setGenerationChip: noop, setIsFirstMessage: noop,
    setRuntimeHydrationVersion: noop, startFirstMessageRename: noop, startSession: noop,
    updateRuntimeUiState: noop, videoSubMode: 'text-to-video',
    snapshot: buildSubmittedComposerSnapshot({ selectedModels: ['model'], selectedActModel: 'model', activeChatTitle: null,
      selectedImageModels: ['image-model'], selectedVideoModels: [], attachedImages: [], pendingChatDocuments: [],
      mentions: [], isTemporaryChat: false, mode: 'chat', selectedToolIds: [], memoryEnabled: false, text: 'Draw a tree' }),
  }
}

test('native media cannot execute on failed persistence or after a newer first-send intent', async t => {
  const provider = t.mock.method(overlayAppClient.chat, 'generateImageResponse', async () => Response.json({ url: '/image' }))
  const rejected = nativeMediaArgs()
  rejected.submitNativePersonalTurn = async () => { throw new Error('denied') }
  await assert.rejects(sendMediaTurn(rejected), /denied/)
  assert.equal(rejected.pendingFirstSendRef!.current, null)
  assert.equal([...rejected.emptyRuntime.nativePendingTurns!.values()][0].localGenerationResults?.[0].status, 'failed')
  const superseded = nativeMediaArgs()
  superseded.submitNativePersonalTurn = async () => {
    superseded.pendingFirstSendRef!.current = { ...superseded.pendingFirstSendRef!.current!, conversationClientId: 'new-intent' }
    return { conversationId: 'saved-chat', messageId: 'user' } as never
  }
  await sendMediaTurn(superseded)
  assert.equal(superseded.pendingFirstSendRef!.current?.conversationClientId, 'new-intent')
  assert.equal(provider.mock.callCount(), 0)
})

test('native media persists first and executes with the real conversation and same turn ID', { timeout: 5000 }, async t => {
  t.mock.method(overlayAppClient.conversations, 'addMessageResponse', async () => new Response(null, { status: 204 }))
  const events: string[] = []
  const args = nativeMediaArgs()
  let turnId = ''
  args.submitNativePersonalTurn = async input => {
    events.push('persist')
    turnId = input.turnId
    assert.ok(input.clientId)
    return { conversationId: 'saved-chat', messageId: 'user' } as never
  }
  const provider = t.mock.method(overlayAppClient.chat, 'generateImageResponse', async input => {
    events.push('execute')
    assert.equal(input.conversationId, 'saved-chat')
    assert.equal(input.turnId, turnId)
    return Response.json({ url: '/image', outputId: 'output', modelUsed: 'image-model' })
  })
  const completed = new Promise<void>(resolve => { args.completeSessionForStream = () => resolve() })
  await sendMediaTurn(args)
  await completed
  assert.equal(provider.mock.callCount(), 1)
  assert.deepEqual(events, ['persist', 'execute'])
  assert.equal(args.emptyRuntime.nativePendingTurns!.get(turnId)?.localGenerationResults?.[0].status, 'completed')
})

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
    const pendingFirstSendRef: { current: PendingFirstSendState | null } = { current: null }
    const noop = () => undefined
    await sendMediaTurn({
      activeChatId: null, activeChatIdRef: { current: null }, applyUiStateToView: noop,
      completeSession: noop,
      createNewChat: async (options) => {
        if (options?.deferActivation) {
          assert.equal(options.persistedChatId, 'new-chat')
          assert.ok(pendingFirstSendRef.current)
          pendingFirstSendRef.current.realChatId = options.persistedChatId!
          startPendingFirstSendRename(pendingFirstSendRef.current, (_id, _seed, nativeOwner) => titleOwners.push(nativeOwner))
          return options.persistedChatId!
        }
        options?.prepareRuntime?.({ chatId: 'new-chat', runtime: target, selectedModels: ['image-model'], selectedActModel: 'model' })
        return 'new-chat'
      },
      effectiveGenType: 'image', emptyRuntime: runtime(), ensureConversationRuntime: () => target,
      isSendBlocked: true, isFirstMessage: true, isTemporaryChatRef: { current: false },
      loadChats: async () => {}, loadSubscription: async () => {}, nativePersonalEnabled: true,
      nativePersonalRoute: scope === 'personal', nativeWorkspaceId: 'workspace', nativeOwnerId: 'owner',
      submitNativePersonalTurn: async () => ({ conversationId: 'new-chat', messageId: 'user' }) as never,
      pendingFirstSendRef, isCurrentScope: () => true, isStreamChatActive: () => true,
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
