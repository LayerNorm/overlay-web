import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { VideoSubMode } from '@/shared/ai/gateway/model-types'
import type { NativePersonalSubmitArgs } from '@/components/providers/PersonalChatProvider'
import type { PersonalPendingTurn, PersonalTranscriptMessage } from './personal-transcript'
import type { PendingFirstSendState } from './chat-send-pending-first'
import { PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'
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
import { workspaceChatsViewActive, type CreateNewChatOptions } from './chat-send-create'

export async function sendMediaTurn({
  activeChatId,
  activeChatIdRef,
  applyUiStateToView,
  completeSession,
  createNewChat,
  effectiveGenType,
  emptyRuntime,
  ensureConversationRuntime,
  isSendBlocked,
  isFirstMessage,
  isTemporaryChatRef,
  loadChats,
  loadSubscription,
  nativePersonalEnabled = false,
  nativePersonalRoute = false,
  nativeOwnerId,
  nativeWorkspaceId,
  submitNativePersonalTurn,
  setPendingTranscriptConversation,
  isCurrentScope,
  isStreamChatActive,
  pendingFirstSendRef,
  completeSessionForStream,
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
  isSendBlocked: boolean
  isFirstMessage: boolean
  isTemporaryChatRef: MutableRefObject<boolean>
  loadChats: () => Promise<void>
  loadSubscription: () => Promise<unknown>
  nativePersonalEnabled?: boolean
  nativePersonalRoute?: boolean
  nativeOwnerId?: string | null
  nativeWorkspaceId?: string | null
  submitNativePersonalTurn?: (args: NativePersonalSubmitArgs) => Promise<{ conversationId: string; messageId: string }>
  setPendingTranscriptConversation?: (conversationId: string | null, ownerId?: string | null, intentKey?: string) => void
  isCurrentScope?: () => boolean
  isStreamChatActive?: (chatId: string, temporaryChatSnapshot: boolean) => boolean
  pendingFirstSendRef?: MutableRefObject<PendingFirstSendState | null>
  completeSessionForStream?: CompleteSession
  markChatModified: (chatId: string, titleSnapshot?: string | null, nativePersonalOwner?: boolean) => void
  pendingScrollChatIdRef: MutableRefObject<string | null>
  pendingScrollTurnIdRef: MutableRefObject<string | null>
  replyContext: ReplyContext
  selectedActModel: string
  setGenerationChip: (chip: 'image' | 'video' | null) => void
  setIsFirstMessage: (isFirstMessage: boolean) => void
  setRuntimeHydrationVersion: Dispatch<SetStateAction<number>>
  snapshot: SubmittedComposerSnapshot
  startFirstMessageRename: (chatId: string, seedText: string, nativePersonalOwner?: boolean) => void
  startSession: StartSession
  updateRuntimeUiState: UpdateRuntimeUiState
  videoSubMode: VideoSubMode
}) {
  const mediaGenerationModule = import('./chatMediaGeneration')
  const wasFirst = isFirstMessage
  const promptForModel = buildMediaPromptForModel(replyContext, snapshot.text)
  const nativePersonalTurn = nativePersonalEnabled && nativePersonalRoute
    && !snapshot.temporaryChatSnapshot && !workspaceChatsViewActive()
  const existingChatId = snapshot.temporaryChatSnapshot
    ? TEMPORARY_CHAT_ID
    : (activeChatIdRef.current ?? activeChatId)
  const selectedMediaModels = effectiveGenType === 'image'
    ? snapshot.selectedImageModelsSnapshot
    : snapshot.selectedVideoModelsSnapshot
  const modelId = selectedMediaModels[0] ?? ''
  const initialRuntime = existingChatId
    ? ensureConversationRuntime(existingChatId)
    : emptyRuntime
  const submissionKey = JSON.stringify([
    nativeWorkspaceId,
    existingChatId,
    effectiveGenType,
    selectedActModel,
    modelId,
    snapshot.text,
    snapshot.attachedImagesSnapshot.map(image => [image.name, image.mimeType, image.dataUrl]),
    snapshot.pendingChatDocumentsSnapshot.map(document => [document.name, document.fileIds, document.status]),
    snapshot.mentionsSnapshot,
    replyContext,
    videoSubMode,
  ])
  const previousNativeAttempt = nativePersonalTurn
    ? [...(initialRuntime.nativePendingTurns?.values() ?? [])].find(turn =>
        turn.ownerId === nativeOwnerId && turn.workspaceId === nativeWorkspaceId
        && turn.submissionKey === submissionKey && turn.submitArgs)
    : undefined
  const mediaTurnId = previousNativeAttempt?.turnId ?? crypto.randomUUID()
  const mediaUserMessage = buildMediaUserMessage({
    turnId: mediaTurnId,
    text: snapshot.text,
    attachedImages: snapshot.attachedImagesSnapshot,
    replyContext,
  })
  let exchIdx = 0
  let preparedFirstSendRuntime = false
  setGenerationChip(null)

  const prepareMediaRuntime = (runtime: ConversationRuntime) => {
    const ui = runtime.ui
    exchIdx = ui.exchangeModels.length
    const nextGenerationResults = cloneGenerationResultsMap(ui.generationResults)
    nextGenerationResults.set(
      exchIdx,
      [{ type: effectiveGenType, status: 'generating' as const }],
    )
    runtime.ui = createConversationUiState({
      ...ui,
      exchangeModes: [...ui.exchangeModes, 'act'],
      exchangeModels: [...ui.exchangeModels, [modelId]],
      exchangeGenTypes: [...ui.exchangeGenTypes, effectiveGenType],
      generationResults: nextGenerationResults,
      isFirstMessage: false,
    })
    runtime.askChats[0].messages = [...runtime.askChats[0].messages, mediaUserMessage as never]
  }

  const nativePersonalCreated = nativePersonalTurn && !existingChatId
  pendingScrollTurnIdRef.current = mediaTurnId
  pendingScrollChatIdRef.current = snapshot.temporaryChatSnapshot ? null : existingChatId
  let chatId = existingChatId
  let executionChatId = existingChatId
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
      selectedModels: [modelId],
      activeChatTitle: snapshot.activeChatTitleSnapshot ?? null,
      isFirstMessage: false,
    })
    prepareMediaRuntime(previewRuntime)
    previewRuntime.hydrated = true
    applyUiStateToView(previewRuntime.ui)
    setIsFirstMessage(false)
    setRuntimeHydrationVersion((value) => value + 1)
    if (nativePersonalTurn) {
      const previousClientId = previousNativeAttempt?.submitArgs?.clientId
      const conversationClientId = typeof previousClientId === 'string' ? previousClientId : crypto.randomUUID()
      if (!pendingFirstSendRef) throw new Error('Native personal chat is unavailable')
      pendingFirstSendRef.current = {
        conversationClientId,
        previewRuntime,
        streamDone: false,
        realChatId: null,
        wasFirst: isFirstMessage,
        renameStarted: false,
        renameSeed: snapshot.text || 'Generated media',
        activeChatTitleSnapshot: snapshot.activeChatTitleSnapshot,
        reasoningByModelSnapshot: {},
        nativePersonalOwner: true,
      }
      chatId = PENDING_FIRST_CHAT_ID
      executionChatId = null
      targetRuntime = previewRuntime
      preparedFirstSendRuntime = true
    } else {
      chatId = await createNewChat({
        prepareRuntime: ({ runtime }) => {
          prepareMediaRuntime(runtime)
          preparedFirstSendRuntime = true
        },
      })
    }
  }
  if (!chatId) return
  if (!snapshot.temporaryChatSnapshot) markChatModified(chatId, snapshot.activeChatTitleSnapshot, nativePersonalCreated)
  if (!snapshot.temporaryChatSnapshot && chatId !== PENDING_FIRST_CHAT_ID) targetRuntime = ensureConversationRuntime(chatId)
  else targetRuntime = emptyRuntime
  if (nativePersonalTurn) {
    const pendingIntent = pendingFirstSendRef?.current
    const isCurrentSend = () => Boolean(isCurrentScope?.() && isStreamChatActive?.(chatId!, false)
      && (chatId !== PENDING_FIRST_CHAT_ID || pendingFirstSendRef?.current === pendingIntent))
    const docs = snapshot.pendingChatDocumentsSnapshot.filter(document => document.status === 'ready')
    const nativeArgs = (previousNativeAttempt?.submitArgs as NativePersonalSubmitArgs | undefined) ?? {
      workspaceId: nativeWorkspaceId!,
      ...(existingChatId ? { conversationId: existingChatId as NativePersonalSubmitArgs['conversationId'] } : {}),
      ...(!existingChatId ? {
        clientId: pendingFirstSendRef?.current?.conversationClientId ?? crypto.randomUUID(),
        title: snapshot.activeChatTitleSnapshot ?? 'New conversation',
      } : {}),
      turnId: mediaTurnId,
      mode: 'act' as const,
      modelId,
      contentType: effectiveGenType,
      parts: mediaUserMessage.parts as NativePersonalSubmitArgs['parts'],
      attachmentNames: [...snapshot.attachedImagesSnapshot.map(image => image.name), ...docs.map(document => document.name)],
      userMetadata: {
        ...(docs.length ? { indexedDocuments: docs.map(document => document.name), indexedAttachments: docs.map(document => ({ name: document.name, fileIds: document.fileIds })) } : {}),
        ...(snapshot.mentionsSnapshot.length ? { mentions: snapshot.mentionsSnapshot.map(({ type, id, name, meta }) => ({ type, id, name, ...(meta?.fileIds ? { fileIds: meta.fileIds as string[] } : {}) })) } : {}),
      },
      ...(replyContext?.replyToTurnId ? { replyToTurnId: replyContext.replyToTurnId, replySnippet: replyContext.snippet } : {}),
    }
    const pendingNativeTurn: PersonalPendingTurn = {
      turnId: mediaTurnId,
      user: previousNativeAttempt?.user ?? ({
        ...mediaUserMessage,
        turnId: mediaTurnId,
        mode: 'act',
        contentType: effectiveGenType,
        createdAt: Date.now(),
      } as PersonalTranscriptMessage),
      responses: [],
      userAcknowledged: previousNativeAttempt?.userAcknowledged ?? false,
      ownerId: nativeOwnerId ?? undefined,
      workspaceId: nativeWorkspaceId ?? undefined,
      submissionKey,
      submitArgs: nativeArgs as unknown as Record<string, unknown>,
      localGenerationResults: [{ type: effectiveGenType, status: 'generating' }],
    }
    targetRuntime.nativePendingTurns ??= new Map()
    targetRuntime.nativePendingTurns.set(mediaTurnId, pendingNativeTurn)
    setRuntimeHydrationVersion(value => value + 1)
    try {
      if (!nativeWorkspaceId || !submitNativePersonalTurn || !isCurrentScope?.()
        || !isStreamChatActive?.(chatId, false)) throw new Error('Native personal chat is unavailable')
      const submitted = await submitNativePersonalTurn(nativeArgs)
      if (!isCurrentSend()) return
      executionChatId = submitted.conversationId
      if (!existingChatId) {
        const realId = await createNewChat({
          clientId: String(nativeArgs.clientId),
          persistedChatId: submitted.conversationId,
          deferActivation: true,
        })
        if (!realId || !isCurrentSend()) return
        setPendingTranscriptConversation?.(realId, nativeOwnerId, mediaTurnId)
      }
    } catch (error) {
      if (!isCurrentSend()) return
      pendingNativeTurn.localGenerationResults = [{
        type: effectiveGenType, status: 'failed', error: 'Message could not be saved. Retry to send.',
      }]
      if (isCurrentScope?.() && isStreamChatActive?.(chatId, false)) {
        if (pendingFirstSendRef?.current && pendingFirstSendRef.current.conversationClientId === nativeArgs.clientId) {
          pendingFirstSendRef.current = null
        }
        setPendingTranscriptConversation?.(null, nativeOwnerId, mediaTurnId)
        setRuntimeHydrationVersion(version => version + 1)
      }
      throw error
    }
  }

  if (!snapshot.temporaryChatSnapshot && !preparedFirstSendRuntime) {
    updateRuntimeUiState(chatId, (prev) => {
      exchIdx = prev.exchangeModels.length
      const nextGenerationResults = cloneGenerationResultsMap(prev.generationResults)
      nextGenerationResults.set(
        exchIdx,
        [{ type: effectiveGenType, status: 'generating' as const }],
      )
      return {
        ...prev,
        exchangeModes: [...prev.exchangeModes, 'act'],
        exchangeModels: [...prev.exchangeModels, [modelId]],
        exchangeGenTypes: [...prev.exchangeGenTypes, effectiveGenType],
        generationResults: nextGenerationResults,
        isFirstMessage: false,
      }
    })
    targetRuntime.askChats[0].messages = [...targetRuntime.askChats[0].messages, mediaUserMessage as never]
  }

  setIsFirstMessage(false)
  if (!snapshot.temporaryChatSnapshot && !nativePersonalTurn) {
    void overlayAppClient.conversations.addMessageResponse(
      {
        conversationId: chatId,
        turnId: mediaTurnId,
        mode: 'act',
        role: 'user',
        content: snapshot.text,
        parts: [{ type: 'text', text: snapshot.text }],
        modelId,
        ...(replyContext?.replyToTurnId
          ? { replyToTurnId: replyContext.replyToTurnId, replySnippet: replyContext.snippet }
          : {}),
      },
      { idempotencyKey: `${mediaTurnId}:user` },
    )
    if (wasFirst && snapshot.text) startFirstMessageRename(chatId, snapshot.text, nativePersonalCreated)
  }
  startSession(
    chatId,
    'act',
    snapshot.temporaryChatSnapshot ? 'Temporary chat' : snapshot.activeChatTitleSnapshot ?? '',
    targetRuntime.askChats[0].messages.length,
  )
  const updateMediaRuntimeUiState = snapshot.temporaryChatSnapshot || nativePersonalTurn
    ? (_chatId: string, updater: (prev: ConversationUiState) => ConversationUiState) => {
        targetRuntime.ui = updater(cloneConversationUiState(targetRuntime.ui))
        const pending = targetRuntime.nativePendingTurns?.get(mediaTurnId)
        if (pending) pending.localGenerationResults = targetRuntime.ui.generationResults.get(exchIdx)
        if (snapshot.temporaryChatSnapshot || (isCurrentScope?.() && isStreamChatActive?.(chatId!, false))) {
          applyUiStateToView(targetRuntime.ui)
        }
        setRuntimeHydrationVersion((value) => value + 1)
      }
    : updateRuntimeUiState

  const mediaIsChatActive = (id: string) =>
    snapshot.temporaryChatSnapshot
      ? (id === TEMPORARY_CHAT_ID && isTemporaryChatRef.current)
      : nativePersonalTurn && id === executionChatId
        ? Boolean(isStreamChatActive?.(chatId ?? id, false))
        : activeChatIdRef.current === id

  if (isSendBlocked) return

  if (effectiveGenType === 'image') {
    const { runImageGenerationBatch } = await mediaGenerationModule
    const imageUrl = snapshot.attachedImagesSnapshot[0]?.dataUrl ?? targetRuntime.ui.lastGeneratedImageUrl
    runImageGenerationBatch({
      chatId: executionChatId ?? chatId,
      temporaryChat: snapshot.temporaryChatSnapshot,
      turnId: mediaTurnId,
      exchIdx,
      promptForModel,
      userPromptText: snapshot.text,
      modelId,
      targetRuntime,
      imageUrl,
      isChatActive: mediaIsChatActive,
      updateRuntimeUiState: updateMediaRuntimeUiState,
      completeSession: nativePersonalTurn && chatId === PENDING_FIRST_CHAT_ID
        ? (_id, active) => { if (active) completeSessionForStream?.(PENDING_FIRST_CHAT_ID, true) }
        : completeSession,
      loadChats: snapshot.temporaryChatSnapshot ? (() => {}) : loadChats,
      loadSubscription,
    })
  } else {
    const { runVideoGenerationBatch } = await mediaGenerationModule
    runVideoGenerationBatch({
      chatId: executionChatId ?? chatId,
      temporaryChat: snapshot.temporaryChatSnapshot,
      turnId: mediaTurnId,
      exchIdx,
      promptForModel,
      userPromptText: snapshot.text,
      modelId,
      targetRuntime,
      videoSubMode,
      imageUrl: snapshot.attachedImagesSnapshot[0]?.dataUrl ?? null,
      isChatActive: mediaIsChatActive,
      updateRuntimeUiState: updateMediaRuntimeUiState,
      completeSession: nativePersonalTurn && chatId === PENDING_FIRST_CHAT_ID
        ? (_id, active) => { if (active) completeSessionForStream?.(PENDING_FIRST_CHAT_ID, true) }
        : completeSession,
      loadChats: snapshot.temporaryChatSnapshot ? (() => {}) : loadChats,
      loadSubscription,
    })
  }
}
