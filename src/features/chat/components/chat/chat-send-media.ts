import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { VideoSubMode } from '@/shared/ai/gateway/model-types'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  cloneConversationUiState,
  cloneGenerationResultsMap,
  createConversationUiState,
} from '@overlay/chat-core'
import type {
  ConversationRuntime,
  ConversationUiState,
} from '../chat-interface/types'
import { resetRuntimeState } from './conversation-runtime-utils'
import {
  buildMediaPromptForModel,
  buildMediaUserMessage,
  TEMPORARY_CHAT_ID,
  type CompleteSession,
  type EnsureConversationRuntime,
  type ReplyContext,
  type SubmittedComposerSnapshot,
  type StartSession,
  type UpdateRuntimeUiState,
} from './chat-send-body-builders'
import type { CreateNewChatOptions } from './chat-send-create'

export async function sendMediaTurn({
  activeChatId,
  activeChatIdRef,
  applyUiStateToView,
  completeSession,
  createNewChat,
  effectiveGenType,
  emptyRuntime,
  ensureConversationRuntime,
  isFreeTier,
  isFirstMessage,
  isTemporaryChatRef,
  loadChats,
  loadSubscription,
  markChatModified,
  pendingScrollChatIdRef,
  pendingScrollTurnIdRef,
  replyContext,
  selectedActModel,
  setGenerationChip,
  setIsFirstMessage,
  setRuntimeHydrationVersion,
  snapshot,
  startFirstMessageRename,
  startSession,
  updateRuntimeUiState,
  videoSubMode,
}: {
  activeChatId: string | null
  activeChatIdRef: MutableRefObject<string | null>
  applyUiStateToView: (ui: ConversationUiState) => void
  completeSession: CompleteSession
  createNewChat: (options?: CreateNewChatOptions) => Promise<string | null>
  effectiveGenType: 'image' | 'video'
  emptyRuntime: ConversationRuntime
  ensureConversationRuntime: EnsureConversationRuntime
  isFreeTier: boolean
  isFirstMessage: boolean
  isTemporaryChatRef: MutableRefObject<boolean>
  loadChats: () => Promise<void>
  loadSubscription: () => Promise<unknown>
  markChatModified: (chatId: string, titleSnapshot?: string | null) => void
  pendingScrollChatIdRef: MutableRefObject<string | null>
  pendingScrollTurnIdRef: MutableRefObject<string | null>
  replyContext: ReplyContext
  selectedActModel: string
  setGenerationChip: (chip: 'image' | 'video' | null) => void
  setIsFirstMessage: (isFirstMessage: boolean) => void
  setRuntimeHydrationVersion: Dispatch<SetStateAction<number>>
  snapshot: SubmittedComposerSnapshot
  startFirstMessageRename: (chatId: string, seedText: string) => void
  startSession: StartSession
  updateRuntimeUiState: UpdateRuntimeUiState
  videoSubMode: VideoSubMode
}) {
  const mediaGenerationModule = import('./chatMediaGeneration')
  const wasFirst = isFirstMessage
  const promptForModel = buildMediaPromptForModel(replyContext, snapshot.text)
  const mediaTurnId = crypto.randomUUID()
  const activeModels = effectiveGenType === 'image'
    ? snapshot.selectedImageModelsSnapshot
    : snapshot.selectedVideoModelsSnapshot
  const mediaUserMessage = buildMediaUserMessage({
    turnId: mediaTurnId,
    text: snapshot.text,
    attachedImages: snapshot.attachedImagesSnapshot,
    replyContext,
  })
  const mediaSlotCount = Math.max(1, activeModels.length)
  let exchIdx = 0
  let preparedFirstSendRuntime = false
  setGenerationChip(null)

  const prepareMediaRuntime = (runtime: ConversationRuntime) => {
    const ui = runtime.ui
    exchIdx = ui.exchangeModels.length
    const nextGenerationResults = cloneGenerationResultsMap(ui.generationResults)
    nextGenerationResults.set(
      exchIdx,
      activeModels.map(() => ({ type: effectiveGenType, status: 'generating' as const })),
    )
    runtime.ui = createConversationUiState({
      ...ui,
      exchangeModes: [...ui.exchangeModes, 'act'],
      exchangeModels: [...ui.exchangeModels, [...activeModels]],
      selectedTabPerExchange: [...ui.selectedTabPerExchange, 0],
      exchangeGenTypes: [...ui.exchangeGenTypes, effectiveGenType],
      generationResults: nextGenerationResults,
      isFirstMessage: false,
    })
    runtime.askChats.slice(0, mediaSlotCount).forEach((chat) => {
      chat.messages = [
        ...chat.messages,
        mediaUserMessage as never,
      ]
    })
  }

  const existingChatId = snapshot.temporaryChatSnapshot
    ? TEMPORARY_CHAT_ID
    : (activeChatIdRef.current ?? activeChatId)
  pendingScrollTurnIdRef.current = mediaTurnId
  pendingScrollChatIdRef.current = snapshot.temporaryChatSnapshot ? null : existingChatId
  let chatId = existingChatId
  let targetRuntime: ConversationRuntime
  if (snapshot.temporaryChatSnapshot) {
    targetRuntime = emptyRuntime
    prepareMediaRuntime(targetRuntime)
    targetRuntime.hydrated = true
    applyUiStateToView(targetRuntime.ui)
    setIsFirstMessage(false)
    setRuntimeHydrationVersion((value) => value + 1)
  } else if (!existingChatId) {
    const previewRuntime = emptyRuntime
    resetRuntimeState(previewRuntime, {
      selectedActModel,
      selectedModels: activeModels,
      askModelSelectionMode: activeModels.length > 1 ? 'multiple' : 'single',
      activeChatTitle: snapshot.activeChatTitleSnapshot ?? null,
      isFirstMessage: false,
    })
    prepareMediaRuntime(previewRuntime)
    previewRuntime.hydrated = true
    applyUiStateToView(previewRuntime.ui)
    setIsFirstMessage(false)
    setRuntimeHydrationVersion((value) => value + 1)
    chatId = await createNewChat({
      prepareRuntime: ({ runtime }) => {
        prepareMediaRuntime(runtime)
        preparedFirstSendRuntime = true
      },
    })
  }
  if (!chatId) return
  if (!snapshot.temporaryChatSnapshot) markChatModified(chatId, snapshot.activeChatTitleSnapshot)
  if (!snapshot.temporaryChatSnapshot) targetRuntime = ensureConversationRuntime(chatId)
  else targetRuntime = emptyRuntime

  if (!snapshot.temporaryChatSnapshot && !preparedFirstSendRuntime) {
    updateRuntimeUiState(chatId, (prev) => {
      exchIdx = prev.exchangeModels.length
      const nextGenerationResults = cloneGenerationResultsMap(prev.generationResults)
      nextGenerationResults.set(
        exchIdx,
        activeModels.map(() => ({ type: effectiveGenType, status: 'generating' as const })),
      )
      return {
        ...prev,
        exchangeModes: [...prev.exchangeModes, 'act'],
        exchangeModels: [...prev.exchangeModels, [...activeModels]],
        selectedTabPerExchange: [...prev.selectedTabPerExchange, 0],
        exchangeGenTypes: [...prev.exchangeGenTypes, effectiveGenType],
        generationResults: nextGenerationResults,
        isFirstMessage: false,
      }
    })
    targetRuntime.askChats.slice(0, mediaSlotCount).forEach((chat) => {
      chat.messages = [
        ...chat.messages,
        mediaUserMessage as never,
      ]
    })
  }

  setIsFirstMessage(false)
  if (!snapshot.temporaryChatSnapshot) {
    void overlayAppClient.conversations.addMessageResponse(
      {
        conversationId: chatId,
        turnId: mediaTurnId,
        mode: 'act',
        role: 'user',
        content: snapshot.text,
        parts: [{ type: 'text', text: snapshot.text }],
        modelId: activeModels[0],
        ...(replyContext?.replyToTurnId
          ? { replyToTurnId: replyContext.replyToTurnId, replySnippet: replyContext.snippet }
          : {}),
      },
      { idempotencyKey: `${mediaTurnId}:user` },
    )
    if (wasFirst && snapshot.text) startFirstMessageRename(chatId, snapshot.text)
  }
  startSession(
    chatId,
    'act',
    snapshot.temporaryChatSnapshot ? 'Temporary chat' : snapshot.activeChatTitleSnapshot ?? '',
    targetRuntime.askChats[0].messages.length,
  )
  const updateMediaRuntimeUiState = snapshot.temporaryChatSnapshot
    ? (_chatId: string, updater: (prev: ConversationUiState) => ConversationUiState) => {
        targetRuntime.ui = updater(cloneConversationUiState(targetRuntime.ui))
        applyUiStateToView(targetRuntime.ui)
        setRuntimeHydrationVersion((value) => value + 1)
      }
    : updateRuntimeUiState

  const mediaIsChatActive = (id: string) =>
    snapshot.temporaryChatSnapshot
      ? (id === TEMPORARY_CHAT_ID && isTemporaryChatRef.current)
      : activeChatIdRef.current === id

  if (isFreeTier) {
    const { scheduleMediaGenerationUpgradeFailure } = await mediaGenerationModule
    scheduleMediaGenerationUpgradeFailure({
      chatId,
      exchIdx,
      kind: effectiveGenType,
      activeModels,
      isChatActive: mediaIsChatActive,
      updateRuntimeUiState: updateMediaRuntimeUiState,
      completeSession,
    })
    return
  }

  if (effectiveGenType === 'image') {
    const { runImageGenerationBatch } = await mediaGenerationModule
    const imageUrl = snapshot.attachedImagesSnapshot[0]?.dataUrl ?? targetRuntime.ui.lastGeneratedImageUrl
    runImageGenerationBatch({
      chatId,
      temporaryChat: snapshot.temporaryChatSnapshot,
      turnId: mediaTurnId,
      exchIdx,
      promptForModel,
      userPromptText: snapshot.text,
      activeModels,
      targetRuntime,
      mediaSlotCount,
      imageUrl,
      isChatActive: mediaIsChatActive,
      updateRuntimeUiState: updateMediaRuntimeUiState,
      completeSession,
      loadChats: snapshot.temporaryChatSnapshot ? (() => {}) : loadChats,
      loadSubscription,
    })
  } else {
    const { runVideoGenerationBatch } = await mediaGenerationModule
    runVideoGenerationBatch({
      chatId,
      temporaryChat: snapshot.temporaryChatSnapshot,
      turnId: mediaTurnId,
      exchIdx,
      promptForModel,
      userPromptText: snapshot.text,
      activeModels,
      targetRuntime,
      mediaSlotCount,
      videoSubMode,
      imageUrl: snapshot.attachedImagesSnapshot[0]?.dataUrl ?? null,
      isChatActive: mediaIsChatActive,
      updateRuntimeUiState: updateMediaRuntimeUiState,
      completeSession,
      loadChats: snapshot.temporaryChatSnapshot ? (() => {}) : loadChats,
      loadSubscription,
    })
  }
}
