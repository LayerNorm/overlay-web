'use client'

import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react'
import posthog from 'posthog-js'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { MentionItem } from '@/shared/knowledge/mention-types'
import type { ChatToolRequestId } from '@/shared/chat/tool-requests'
import type { VideoSubMode } from '@/shared/ai/gateway/model-types'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { createIdempotencyKey } from '@overlay/api-client'
import { AUTOMATIONS_UPDATED_EVENT } from '@overlay/app-core/automations'
import {
  cloneConversationUiState,
  cloneGenerationResultsMap,
  createConversationUiState,
} from '@overlay/chat-core'
import {
  beginTtftClientTurn,
  markTtftClientMilestone,
  setTtftClientTurnId,
} from '@/shared/chat/ttft-client-debug'
import {
  dispatchChatCreated,
} from '@/shared/chat/chat-title'
import {
  upsertCachedChat,
} from '@/shared/chat/chat-list-cache'
import { DEFAULT_CHAT_TITLE } from '../chat-interface/constants'
import type { MentionInputHandle } from '../chat-interface/MentionInput'
import type {
  AskModelSelectionMode,
  AttachedImage,
  ChatMessageMetadata,
  Conversation,
  ConversationRuntime,
  ConversationUiState,
  PendingChatDocument,
} from '../chat-interface/types'
import { resetRuntimeState } from './conversation-runtime-utils'
import { prepareAskModelThreadsForTextTurn } from './chat-runtime-helpers'
import {
  reportTextStreamError,
  startActTextStream,
} from '../useChatTransport'

export const TEMPORARY_CHAT_ID = '__overlay_temporary_chat__'
export const PENDING_FIRST_CHAT_ID = '__overlay_pending_first_chat__'

type PendingFirstSendState = {
  conversationClientId: string
  previewRuntime: ConversationRuntime
  streamDone: boolean
  realChatId: string | null
  wasFirst: boolean
  renameSeed: string
  activeChatTitleSnapshot: string | null
}

type ReplyContext = {
  snippet: string
  bodyForModel: string
  replyToTurnId?: string
} | null

type CreateNewChatOptions = {
  title?: string
  clientId?: string
  deferActivation?: boolean
  prepareRuntime?: (args: {
    chatId: string
    runtime: ConversationRuntime
    selectedModels: string[]
    selectedActModel: string
    askModelSelectionMode: AskModelSelectionMode
  }) => void
}

type StartSession = (
  chatId: string,
  mode: 'act',
  title: string,
  messageCountAtStart: number,
) => void

type CompleteSession = (chatId: string, active: boolean) => void

export function useChatSendController({
  activeChatId,
  activeChatIdRef,
  activeChatTitle,
  applyUiStateToView,
  askModelSelectionMode,
  attachedImages,
  authUser,
  automationIdParam,
  clearTransientComposerState,
  completeSession,
  effectiveGenType,
  embedProjectId,
  emptyRuntimeRef,
  ensureConversationRuntime,
  inputRef,
  invalidateLoadChatRequest,
  isActiveLoading,
  isBudgetExhaustedPaid,
  isFirstMessage,
  isFreeTier,
  isSendBlocked,
  isTemporaryChat,
  isTemporaryChatRef,
  loadChats,
  loadSubscription,
  markChatModified,
  memoryEnabled,
  mentions,
  mode,
  pendingChatDocuments,
  pendingScrollChatIdRef,
  pendingScrollTurnIdRef,
  persistActiveRuntimeUiState,
  refreshSelectedAutomation,
  replaceConversationRuntime,
  replyContext,
  requireAuth,
  resetComposerToolIds,
  selectedActModel,
  selectedImageModels,
  selectedModels,
  selectedToolIds,
  selectedVideoModels,
  setActiveChatId,
  setActiveViewer,
  setAttachedImages,
  setAttachmentError,
  setChats,
  setComposerNotice,
  setGenerationChip,
  setInput,
  setInterruptedExchangeIdx,
  setIsFirstMessage,
  setIsOptimisticLoading,
  setIsTemporaryChat,
  setMentions,
  setPendingChatDocuments,
  setReplyContext,
  setRuntimeHydrationVersion,
  startFirstMessageRename,
  startSession,
  syncStandaloneChatUrl,
  textareaRef,
  updateRuntimeUiState,
  userId,
  videoSubMode,
}: {
  activeChatId: string | null
  activeChatIdRef: MutableRefObject<string | null>
  activeChatTitle: string | null
  applyUiStateToView: (ui: ConversationUiState) => void
  askModelSelectionMode: AskModelSelectionMode
  attachedImages: AttachedImage[]
  authUser: unknown
  automationIdParam: string | null
  clearTransientComposerState: () => void
  completeSession: CompleteSession
  effectiveGenType: 'image' | 'video' | null
  embedProjectId: string | null
  emptyRuntimeRef: MutableRefObject<ConversationRuntime>
  ensureConversationRuntime: (
    chatId: string,
    uiOverrides?: Partial<ConversationUiState>,
  ) => ConversationRuntime
  inputRef: MutableRefObject<string>
  invalidateLoadChatRequest: () => void
  isActiveLoading: boolean
  isBudgetExhaustedPaid: boolean
  isFirstMessage: boolean
  isFreeTier: boolean
  isSendBlocked: boolean
  isTemporaryChat: boolean
  isTemporaryChatRef: MutableRefObject<boolean>
  loadChats: () => Promise<void>
  loadSubscription: () => Promise<unknown>
  markChatModified: (chatId: string, titleSnapshot?: string | null) => void
  memoryEnabled: boolean
  mentions: MentionItem[]
  mode: 'chat' | 'automate'
  pendingChatDocuments: PendingChatDocument[]
  pendingScrollChatIdRef: MutableRefObject<string | null>
  pendingScrollTurnIdRef: MutableRefObject<string | null>
  persistActiveRuntimeUiState: () => void
  refreshSelectedAutomation: (options?: { showLoading?: boolean }) => Promise<void>
  replaceConversationRuntime: (
    chatId: string,
    uiSnapshot: ConversationUiState,
    askMessages: UIMessage[][],
    actMessages: UIMessage[],
  ) => ConversationRuntime
  replyContext: ReplyContext
  requireAuth: (reason: 'send') => void
  resetComposerToolIds: (temporary: boolean) => void
  selectedActModel: string
  selectedImageModels: string[]
  selectedModels: string[]
  selectedToolIds: ChatToolRequestId[]
  selectedVideoModels: string[]
  setActiveChatId: (chatId: string | null) => void
  setActiveViewer: (chatId: string | null) => void
  setAttachedImages: Dispatch<SetStateAction<AttachedImage[]>>
  setAttachmentError: (error: string | null) => void
  setChats: Dispatch<SetStateAction<Conversation[]>>
  setComposerNotice: Dispatch<SetStateAction<string | null>>
  setGenerationChip: (chip: 'image' | 'video' | null) => void
  setInput: (input: string) => void
  setInterruptedExchangeIdx: (idx: number | null) => void
  setIsFirstMessage: (isFirstMessage: boolean) => void
  setIsOptimisticLoading: (isOptimisticLoading: boolean) => void
  setIsTemporaryChat: (isTemporaryChat: boolean) => void
  setMentions: Dispatch<SetStateAction<MentionItem[]>>
  setPendingChatDocuments: Dispatch<SetStateAction<PendingChatDocument[]>>
  setReplyContext: (context: ReplyContext) => void
  setRuntimeHydrationVersion: Dispatch<SetStateAction<number>>
  startFirstMessageRename: (chatId: string, seedText: string) => void
  startSession: StartSession
  syncStandaloneChatUrl: (chatId: string | null) => void
  textareaRef: RefObject<MentionInputHandle | null>
  updateRuntimeUiState: (
    chatId: string,
    updater: (prev: ConversationUiState) => ConversationUiState,
  ) => void
  userId: string | null
  videoSubMode: VideoSubMode
}) {
  const pendingFirstSendRef = useRef<PendingFirstSendState | null>(null)

  const isStreamChatActive = useCallback((
    chatId: string,
    temporaryChatSnapshot: boolean,
  ) => {
    if (temporaryChatSnapshot) {
      return chatId === TEMPORARY_CHAT_ID && isTemporaryChatRef.current
    }
    if (chatId === PENDING_FIRST_CHAT_ID) {
      return pendingFirstSendRef.current != null
    }
    return activeChatIdRef.current === chatId
  }, [activeChatIdRef, isTemporaryChatRef])

  const tryActivatePendingFirstSend = useCallback(() => {
    const pending = pendingFirstSendRef.current
    if (!pending?.realChatId || !pending.streamDone) return

    const realId = pending.realChatId
    const preview = pending.previewRuntime
    replaceConversationRuntime(
      realId,
      cloneConversationUiState(preview.ui),
      preview.askChats.map((chat) => [...chat.messages]),
      [...preview.actChat.messages],
    )
    markChatModified(realId, pending.activeChatTitleSnapshot)
    if (pending.wasFirst) {
      startFirstMessageRename(realId, pending.renameSeed)
    }
    activeChatIdRef.current = realId
    setActiveViewer(realId)
    setActiveChatId(realId)
    syncStandaloneChatUrl(realId)
    applyUiStateToView(preview.ui)
    resetRuntimeState(emptyRuntimeRef.current)
    pendingFirstSendRef.current = null
    setRuntimeHydrationVersion((value) => value + 1)
  }, [
    activeChatIdRef,
    applyUiStateToView,
    emptyRuntimeRef,
    markChatModified,
    replaceConversationRuntime,
    setActiveChatId,
    setActiveViewer,
    setRuntimeHydrationVersion,
    startFirstMessageRename,
    syncStandaloneChatUrl,
  ])

  const createNewChat = useCallback(async (options: CreateNewChatOptions = {}): Promise<string | null> => {
    // Invalidate any in-flight loadChat request before this newly-created runtime
    // becomes active; otherwise an older load can repaint the view after send.
    invalidateLoadChatRequest()
    persistActiveRuntimeUiState()
    setIsTemporaryChat(false)
    resetComposerToolIds(false)
    const initialTitle = options.title ?? (mode === 'automate' ? 'New automation' : DEFAULT_CHAT_TITLE)
    const normalizedInitialSelection = normalizeChatModelSelection({
      askModelIds: askModelSelectionMode === 'single' ? [selectedActModel] : selectedModels.slice(0, 4),
      actModelId: selectedActModel,
    })
    const initialSelectedModels = normalizedInitialSelection.askModelIds
    const initialAskModelSelectionMode: AskModelSelectionMode = initialSelectedModels.length > 1 ? 'multiple' : 'single'
    const trimmedClientId = options.clientId?.trim()
    const res = await overlayAppClient.conversations.createResponse(
      {
        title: initialTitle,
        askModelIds: initialSelectedModels,
        actModelId: normalizedInitialSelection.actModelId,
        lastMode: 'act',
        ...(embedProjectId ? { projectId: embedProjectId } : {}),
        ...(trimmedClientId ? { clientId: trimmedClientId } : {}),
      },
      { idempotencyKey: trimmedClientId ?? createIdempotencyKey() },
    )
    if (!res.ok) return null

    const data = await res.json()
    setInterruptedExchangeIdx(null)
    const newChat: Conversation = {
      _id: data.id,
      title: initialTitle,
      lastModified: Date.now(),
      lastMode: 'act',
      askModelIds: initialSelectedModels,
      actModelId: normalizedInitialSelection.actModelId,
    }
    upsertCachedChat(newChat)
    setChats((prev) => [newChat, ...prev])
    dispatchChatCreated({ chat: newChat })
    posthog.capture('chat_new_chat_created', { mode: 'act' })

    if (options.deferActivation) {
      const pending = pendingFirstSendRef.current
      if (pending && trimmedClientId && pending.conversationClientId === trimmedClientId) {
        pending.realChatId = data.id
        if (pendingScrollTurnIdRef.current && !pendingScrollChatIdRef.current) {
          pendingScrollChatIdRef.current = data.id
        }
        tryActivatePendingFirstSend()
      }
      return data.id
    }

    const runtime = ensureConversationRuntime(data.id, {
      selectedActModel: normalizedInitialSelection.actModelId,
      selectedModels: initialSelectedModels,
      askModelSelectionMode: initialAskModelSelectionMode,
      activeChatTitle: initialTitle,
      isFirstMessage: true,
    })
    resetRuntimeState(runtime, {
      selectedActModel: normalizedInitialSelection.actModelId,
      selectedModels: initialSelectedModels,
      askModelSelectionMode: initialAskModelSelectionMode,
      activeChatTitle: initialTitle,
      isFirstMessage: true,
    })
    options.prepareRuntime?.({
      chatId: data.id,
      runtime,
      selectedModels: initialSelectedModels,
      selectedActModel: normalizedInitialSelection.actModelId,
      askModelSelectionMode: initialAskModelSelectionMode,
    })
    runtime.hydrated = true
    if (pendingScrollTurnIdRef.current && !pendingScrollChatIdRef.current) {
      pendingScrollChatIdRef.current = data.id
    }
    activeChatIdRef.current = data.id
    setActiveViewer(data.id)
    setActiveChatId(data.id)
    syncStandaloneChatUrl(data.id)
    applyUiStateToView(runtime.ui)
    setRuntimeHydrationVersion((value) => value + 1)
    resetRuntimeState(emptyRuntimeRef.current)
    clearTransientComposerState()
    return data.id
  }, [
    activeChatIdRef,
    applyUiStateToView,
    askModelSelectionMode,
    clearTransientComposerState,
    embedProjectId,
    emptyRuntimeRef,
    ensureConversationRuntime,
    invalidateLoadChatRequest,
    mode,
    pendingScrollChatIdRef,
    pendingScrollTurnIdRef,
    persistActiveRuntimeUiState,
    resetComposerToolIds,
    selectedActModel,
    selectedModels,
    setActiveChatId,
    setActiveViewer,
    setChats,
    setInterruptedExchangeIdx,
    setIsTemporaryChat,
    setRuntimeHydrationVersion,
    syncStandaloneChatUrl,
    tryActivatePendingFirstSend,
  ])

  const completeSessionForStream = useCallback((chatId: string, active: boolean) => {
    if (chatId === PENDING_FIRST_CHAT_ID) {
      const pending = pendingFirstSendRef.current
      if (pending) {
        pending.streamDone = true
        if (!pending.realChatId) {
          void createNewChat({
            clientId: pending.conversationClientId,
            deferActivation: true,
          }).catch(() => {
            setComposerNotice('Could not save chat. Your reply may still have streamed.')
            window.setTimeout(() => setComposerNotice(null), 4000)
          })
        }
      }
      completeSession(chatId, true)
      tryActivatePendingFirstSend()
      return
    }
    completeSession(chatId, active)
  }, [completeSession, createNewChat, setComposerNotice, tryActivatePendingFirstSend])

  const handleSend = useCallback(async () => {
    if (!userId && !authUser) {
      try { sessionStorage.setItem('overlay:guest-draft', inputRef.current) } catch { /* ignore */ }
      requireAuth('send')
      return
    }
    const replyCtxSnapshot = replyContext
    const text = inputRef.current.trim()
    const normalizedTextSelection = normalizeChatModelSelection({
      askModelIds: askModelSelectionMode === 'multiple' ? selectedModels.slice(0, 4) : [selectedActModel],
      actModelId: selectedActModel,
    })
    const selectedActModelSnapshot = normalizedTextSelection.actModelId
    const textModelsForTurn = normalizedTextSelection.askModelIds
    const activeChatTitleSnapshot = activeChatTitle
    const selectedImageModelsSnapshot = [...selectedImageModels]
    const selectedVideoModelsSnapshot = [...selectedVideoModels]
    const attachedImagesSnapshot = [...attachedImages]
    const pendingChatDocumentsSnapshot = [...pendingChatDocuments]
    const mentionsSnapshot = [...mentions]
    const temporaryChatSnapshot = isTemporaryChat
    const requestMode: 'chat' | 'automate' = temporaryChatSnapshot ? 'chat' : mode
    const selectedToolIdsSnapshot = [...selectedToolIds]
    const memoryEnabledSnapshot = memoryEnabled
    const hasReadyDocs = pendingChatDocumentsSnapshot.some((d) => d.status === 'ready')
    const clearSubmittedComposer = () => {
      textareaRef.current?.clear()
      setInput('')
      setMentions([])
      setAttachedImages([])
      setPendingChatDocuments([])
      setAttachmentError(null)
      setReplyContext(null)
      resetComposerToolIds(temporaryChatSnapshot)
    }
    if (isActiveLoading) return

    if (pendingChatDocumentsSnapshot.some((d) => d.status === 'uploading')) {
      setAttachmentError('Wait for documents to finish indexing.')
      return
    }
    if (pendingChatDocumentsSnapshot.some((d) => d.status === 'error')) {
      setAttachmentError('Remove failed documents before sending.')
      return
    }
    if (effectiveGenType === 'image' || effectiveGenType === 'video') {
      if (!text && attachedImagesSnapshot.length === 0) return
    } else if (attachedImagesSnapshot.length === 0 && !text && !hasReadyDocs) {
      return
    }
    if (isSendBlocked) {
      setComposerNotice(
        isBudgetExhaustedPaid
          ? 'Budget exhausted. Add a top-up to continue with paid models, or switch to Auto for free chat.'
          : 'This model requires a paid plan. Switch to Auto or upgrade.',
      )
      return
    }

    posthog.capture('chat_message_sent', {
      mode: 'act',
      generation_type: effectiveGenType,
      has_attachments: attachedImagesSnapshot.length > 0 || pendingChatDocumentsSnapshot.length > 0,
      is_first_message: isFirstMessage,
    })

    beginTtftClientTurn({
      model: selectedActModelSnapshot,
      isFirstMessage,
    })
    setIsOptimisticLoading(true)

    if (effectiveGenType === 'image' || effectiveGenType === 'video') {
      const mediaGenerationModule = import('./chatMediaGeneration')
      const wasFirst = isFirstMessage
      const promptForModel =
        replyCtxSnapshot?.bodyForModel && text
          ? `${text}\n\n---\n[User is replying in thread to prior content]\n${replyCtxSnapshot.bodyForModel}`
          : text
      const mediaSessionMode = 'act'
      const mediaTurnId = crypto.randomUUID()
      const activeModels = effectiveGenType === 'image' ? selectedImageModelsSnapshot : selectedVideoModelsSnapshot
      const mediaUserMessageParts: { type: string; text?: string; url?: string; mediaType?: string; fileName?: string }[] = []
      if (text) mediaUserMessageParts.push({ type: 'text', text })
      for (const img of attachedImagesSnapshot) {
        mediaUserMessageParts.push({ type: 'file', url: img.dataUrl, mediaType: img.mimeType, fileName: img.name })
      }
      const mediaUserMessage = {
        id: mediaTurnId,
        role: 'user',
        parts: mediaUserMessageParts,
        ...(replyCtxSnapshot?.replyToTurnId
          ? {
              metadata: {
                replyToTurnId: replyCtxSnapshot.replyToTurnId,
                replySnippet: replyCtxSnapshot.snippet,
              },
            }
          : {}),
      }
      const mediaSlotCount = Math.max(1, activeModels.length)
      let exchIdx = 0
      let preparedFirstSendRuntime = false
      clearSubmittedComposer()
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mediaUserMessage as any,
          ]
        })
      }

      const existingChatId = temporaryChatSnapshot ? TEMPORARY_CHAT_ID : (activeChatIdRef.current ?? activeChatId)
      pendingScrollTurnIdRef.current = mediaTurnId
      pendingScrollChatIdRef.current = temporaryChatSnapshot ? null : existingChatId
      let chatId = existingChatId
      let targetRuntime: ConversationRuntime
      if (temporaryChatSnapshot) {
        targetRuntime = emptyRuntimeRef.current
        prepareMediaRuntime(targetRuntime)
        targetRuntime.hydrated = true
        applyUiStateToView(targetRuntime.ui)
        setIsFirstMessage(false)
        setRuntimeHydrationVersion((value) => value + 1)
      } else if (!existingChatId) {
        const previewRuntime = emptyRuntimeRef.current
        resetRuntimeState(previewRuntime, {
          selectedActModel,
          selectedModels: activeModels,
          askModelSelectionMode: activeModels.length > 1 ? 'multiple' : 'single',
          activeChatTitle: activeChatTitleSnapshot ?? null,
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
      if (!temporaryChatSnapshot) markChatModified(chatId, activeChatTitleSnapshot)
      if (!temporaryChatSnapshot) targetRuntime = ensureConversationRuntime(chatId)
      else targetRuntime = emptyRuntimeRef.current

      if (!temporaryChatSnapshot && !preparedFirstSendRuntime) {
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mediaUserMessage as any,
          ]
        })
      }

      setIsFirstMessage(false)
      if (!temporaryChatSnapshot) {
        void overlayAppClient.conversations.addMessageResponse(
          {
            conversationId: chatId,
            turnId: mediaTurnId,
            mode: 'act',
            role: 'user',
            content: text,
            parts: [{ type: 'text', text }],
            modelId: activeModels[0],
            ...(replyCtxSnapshot?.replyToTurnId
              ? { replyToTurnId: replyCtxSnapshot.replyToTurnId, replySnippet: replyCtxSnapshot.snippet }
              : {}),
          },
          { idempotencyKey: `${mediaTurnId}:user` },
        )
        if (wasFirst && text) startFirstMessageRename(chatId, text)
      }
      startSession(chatId, mediaSessionMode, temporaryChatSnapshot ? 'Temporary chat' : activeChatTitleSnapshot ?? '', targetRuntime.askChats[0].messages.length)
      const updateMediaRuntimeUiState = temporaryChatSnapshot
        ? (_chatId: string, updater: (prev: ConversationUiState) => ConversationUiState) => {
            targetRuntime.ui = updater(cloneConversationUiState(targetRuntime.ui))
            applyUiStateToView(targetRuntime.ui)
            setRuntimeHydrationVersion((value) => value + 1)
          }
        : updateRuntimeUiState

      if (isFreeTier) {
        const { scheduleMediaGenerationUpgradeFailure } = await mediaGenerationModule
        scheduleMediaGenerationUpgradeFailure({
          chatId,
          exchIdx,
          kind: effectiveGenType,
          activeModels,
          isChatActive: (id) => temporaryChatSnapshot ? (id === TEMPORARY_CHAT_ID && isTemporaryChatRef.current) : activeChatIdRef.current === id,
          updateRuntimeUiState: updateMediaRuntimeUiState,
          completeSession,
        })
        return
      }

      if (effectiveGenType === 'image') {
        const { runImageGenerationBatch } = await mediaGenerationModule
        const imageUrl = attachedImagesSnapshot[0]?.dataUrl ?? targetRuntime.ui.lastGeneratedImageUrl
        runImageGenerationBatch({
          chatId,
          temporaryChat: temporaryChatSnapshot,
          turnId: mediaTurnId,
          exchIdx,
          promptForModel,
          userPromptText: text,
          activeModels,
          targetRuntime,
          mediaSlotCount,
          imageUrl,
          isChatActive: (id) => temporaryChatSnapshot ? (id === TEMPORARY_CHAT_ID && isTemporaryChatRef.current) : activeChatIdRef.current === id,
          updateRuntimeUiState: updateMediaRuntimeUiState,
          completeSession,
          loadChats: temporaryChatSnapshot ? (() => {}) : loadChats,
          loadSubscription,
        })
      } else {
        const { runVideoGenerationBatch } = await mediaGenerationModule
        runVideoGenerationBatch({
          chatId,
          temporaryChat: temporaryChatSnapshot,
          turnId: mediaTurnId,
          exchIdx,
          promptForModel,
          userPromptText: text,
          activeModels,
          targetRuntime,
          mediaSlotCount,
          videoSubMode,
          imageUrl: attachedImagesSnapshot[0]?.dataUrl ?? null,
          isChatActive: (id) => temporaryChatSnapshot ? (id === TEMPORARY_CHAT_ID && isTemporaryChatRef.current) : activeChatIdRef.current === id,
          updateRuntimeUiState: updateMediaRuntimeUiState,
          completeSession,
          loadChats: temporaryChatSnapshot ? (() => {}) : loadChats,
          loadSubscription,
        })
      }
      return
    }

    const readyDocs = pendingChatDocumentsSnapshot.filter((d) => d.status === 'ready')
    const indexedAttachments = readyDocs.map((d) => ({ name: d.name, fileIds: d.fileIds }))
    const indexedFileNames = readyDocs.map((d) => d.name)

    const wasFirst = isFirstMessage
    const textTurnId = crypto.randomUUID()
    setTtftClientTurnId(textTurnId)

    type UiPart = { type: string; text?: string; url?: string; mediaType?: string; fileName?: string }
    const partsForModel: UiPart[] = []
    if (text.trim()) partsForModel.push({ type: 'text', text: text.trim() })
    for (const img of attachedImagesSnapshot) {
      partsForModel.push({ type: 'file', url: img.dataUrl, mediaType: img.mimeType, fileName: img.name })
    }
    const userMeta: ChatMessageMetadata = {}
    if (indexedFileNames.length > 0) {
      userMeta.indexedDocuments = indexedFileNames
      userMeta.indexedAttachments = indexedAttachments
    }
    if (replyCtxSnapshot?.replyToTurnId) {
      userMeta.replyToTurnId = replyCtxSnapshot.replyToTurnId
      userMeta.replySnippet = replyCtxSnapshot.snippet
    }
    if (mentionsSnapshot.length > 0) {
      userMeta.mentions = mentionsSnapshot.map((m) => ({
        type: m.type,
        id: m.id,
        name: m.name,
        ...(m.meta?.fileIds ? { fileIds: m.meta.fileIds as string[] } : {}),
      }))
    }
    const userMetadata = Object.keys(userMeta).length > 0 ? userMeta : undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userUIMessage: any = {
      id: textTurnId,
      role: 'user',
      parts: partsForModel,
      ...(userMetadata ? { metadata: userMetadata } : {}),
    }
    clearSubmittedComposer()

    const multiText = textModelsForTurn.length > 1
    const textSlotCount = Math.min(4, textModelsForTurn.length)
    let msgCountBeforeSend = 0
    let preparedFirstSendRuntime = false
    let textHistoryBaseModelId: string | undefined

    const prepareTextRuntime = (runtime: ConversationRuntime) => {
      textHistoryBaseModelId = prepareAskModelThreadsForTextTurn(runtime, textModelsForTurn).historyBaseModelId
      msgCountBeforeSend = runtime.askChats[0].messages.length
      const ui = runtime.ui
      runtime.ui = createConversationUiState({
        ...ui,
        exchangeModes: [...ui.exchangeModes, 'act'],
        exchangeModels: [...ui.exchangeModels, [...textModelsForTurn]],
        selectedTabPerExchange: [...ui.selectedTabPerExchange, 0],
        exchangeGenTypes: [...ui.exchangeGenTypes, 'text'],
        isFirstMessage: false,
      })
      for (let s = 0; s < textSlotCount; s++) {
        runtime.askChats[s]!.messages = [
          ...runtime.askChats[s]!.messages,
          userUIMessage as UIMessage,
        ]
      }
      if (!multiText) {
        runtime.actChat.messages = [
          ...runtime.actChat.messages,
          userUIMessage as UIMessage,
        ]
      }
    }

    const existingChatId = temporaryChatSnapshot ? TEMPORARY_CHAT_ID : (activeChatIdRef.current ?? activeChatId)
    pendingScrollTurnIdRef.current = textTurnId
    pendingScrollChatIdRef.current = temporaryChatSnapshot ? null : existingChatId
    let chatId = existingChatId
    let targetRuntime: ConversationRuntime
    if (temporaryChatSnapshot) {
      targetRuntime = emptyRuntimeRef.current
      prepareTextRuntime(targetRuntime)
      targetRuntime.hydrated = true
      applyUiStateToView(targetRuntime.ui)
      setIsFirstMessage(false)
      setRuntimeHydrationVersion((value) => value + 1)
    } else if (!existingChatId) {
      const previewRuntime = emptyRuntimeRef.current
      resetRuntimeState(previewRuntime, {
        selectedActModel: selectedActModelSnapshot,
        selectedModels: textModelsForTurn,
        askModelSelectionMode: textModelsForTurn.length > 1 ? 'multiple' : 'single',
        activeChatTitle: activeChatTitleSnapshot ?? null,
        isFirstMessage: false,
      })
      prepareTextRuntime(previewRuntime)
      previewRuntime.hydrated = true
      applyUiStateToView(previewRuntime.ui)
      setIsFirstMessage(false)
      setRuntimeHydrationVersion((value) => value + 1)

      const conversationClientId = crypto.randomUUID()
      pendingFirstSendRef.current = {
        conversationClientId,
        previewRuntime,
        streamDone: false,
        realChatId: null,
        wasFirst,
        renameSeed: text || indexedFileNames[0] || 'Documents',
        activeChatTitleSnapshot,
      }
      chatId = PENDING_FIRST_CHAT_ID
      targetRuntime = previewRuntime
      preparedFirstSendRuntime = true

      void createNewChat({
        clientId: conversationClientId,
        deferActivation: true,
      }).catch(() => {
        setComposerNotice('Could not create chat. Your reply may still stream.')
        window.setTimeout(() => setComposerNotice(null), 4000)
      })
      markTtftClientMilestone('create_started', { conversationClientId })
    } else {
      targetRuntime = ensureConversationRuntime(existingChatId)
    }
    if (!chatId) return
    if (!temporaryChatSnapshot && chatId !== PENDING_FIRST_CHAT_ID) {
      markChatModified(chatId, activeChatTitleSnapshot)
    }

    if (
      !temporaryChatSnapshot &&
      chatId !== PENDING_FIRST_CHAT_ID &&
      wasFirst &&
      (text || indexedFileNames.length > 0)
    ) {
      startFirstMessageRename(chatId, text || indexedFileNames[0] || 'Documents')
    }

    if (!temporaryChatSnapshot && chatId !== PENDING_FIRST_CHAT_ID) {
      activeChatIdRef.current = chatId
    }

    if (!temporaryChatSnapshot && !preparedFirstSendRuntime) {
      textHistoryBaseModelId = prepareAskModelThreadsForTextTurn(targetRuntime, textModelsForTurn).historyBaseModelId
      msgCountBeforeSend = targetRuntime.askChats[0].messages.length
      updateRuntimeUiState(chatId, (prev) => ({
        ...prev,
        exchangeModes: [...prev.exchangeModes, 'act'],
        exchangeModels: [...prev.exchangeModels, [...textModelsForTurn]],
        selectedTabPerExchange: [...prev.selectedTabPerExchange, 0],
        exchangeGenTypes: [...prev.exchangeGenTypes, 'text'],
        isFirstMessage: false,
      }))

      for (let s = 0; s < textSlotCount; s++) {
        targetRuntime.askChats[s]!.messages = [
          ...targetRuntime.askChats[s]!.messages,
          userUIMessage as UIMessage,
        ]
      }
      if (!multiText) {
        targetRuntime.actChat.messages = [
          ...targetRuntime.actChat.messages,
          userUIMessage as UIMessage,
        ]
      }
    }

    startSession(chatId, 'act', temporaryChatSnapshot ? 'Temporary chat' : activeChatTitleSnapshot ?? '', msgCountBeforeSend)

    setIsFirstMessage(false)

    const commonActBody = {
      ...(temporaryChatSnapshot
        ? { temporaryChat: true }
        : chatId === PENDING_FIRST_CHAT_ID
          ? {
              conversationClientId: pendingFirstSendRef.current!.conversationClientId,
              ...(embedProjectId ? { projectId: embedProjectId } : {}),
              askModelIds: textModelsForTurn,
            }
          : { conversationId: chatId }),
      turnId: textTurnId,
      mode: requestMode,
      automationMode: requestMode === 'automate',
      ...(requestMode === 'automate' && automationIdParam ? { automationId: automationIdParam } : {}),
      ...(indexedFileNames.length > 0
        ? { indexedFileNames, indexedAttachments: indexedAttachments }
        : {}),
      ...(replyCtxSnapshot?.bodyForModel ? { replyContextForModel: replyCtxSnapshot.bodyForModel } : {}),
      ...(userMeta.mentions && userMeta.mentions.length > 0 ? { mentions: userMeta.mentions } : {}),
      ...(textHistoryBaseModelId ? { historyBaseModelId: textHistoryBaseModelId } : {}),
      requestedToolIds: selectedToolIdsSnapshot,
      memoryEnabled: memoryEnabledSnapshot,
    }

    const refreshAfterActTextTurn = async () => {
      await loadSubscription()
      if (requestMode === 'automate' && automationIdParam) {
        await refreshSelectedAutomation({ showLoading: false })
        window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
      }
    }

    startActTextStream({
      chatId,
      targetRuntime,
      textModelsForTurn,
      textSlotCount,
      selectedActModel: selectedActModelSnapshot,
      turnId: textTurnId,
      partsForModel,
      userMetadata,
      commonBody: commonActBody,
      isChatActive: (id) => isStreamChatActive(id, temporaryChatSnapshot),
      completeSession: completeSessionForStream,
      loadChats: temporaryChatSnapshot ? (() => {}) : loadChats,
      loadSubscription: refreshAfterActTextTurn,
      onError: (error, fallbackMessage) => reportTextStreamError(setComposerNotice, error, fallbackMessage),
      logPrefix: multiText ? 'Act multi' : 'Act',
    })
  }, [
    activeChatId,
    activeChatIdRef,
    activeChatTitle,
    applyUiStateToView,
    askModelSelectionMode,
    attachedImages,
    authUser,
    automationIdParam,
    completeSession,
    completeSessionForStream,
    createNewChat,
    effectiveGenType,
    embedProjectId,
    emptyRuntimeRef,
    ensureConversationRuntime,
    inputRef,
    isActiveLoading,
    isBudgetExhaustedPaid,
    isFirstMessage,
    isFreeTier,
    isSendBlocked,
    isStreamChatActive,
    isTemporaryChat,
    isTemporaryChatRef,
    loadChats,
    loadSubscription,
    markChatModified,
    memoryEnabled,
    mentions,
    mode,
    pendingChatDocuments,
    pendingScrollChatIdRef,
    pendingScrollTurnIdRef,
    refreshSelectedAutomation,
    replyContext,
    requireAuth,
    resetComposerToolIds,
    selectedActModel,
    selectedImageModels,
    selectedModels,
    selectedToolIds,
    selectedVideoModels,
    setAttachedImages,
    setAttachmentError,
    setComposerNotice,
    setGenerationChip,
    setInput,
    setIsFirstMessage,
    setIsOptimisticLoading,
    setMentions,
    setPendingChatDocuments,
    setReplyContext,
    setRuntimeHydrationVersion,
    startFirstMessageRename,
    startSession,
    textareaRef,
    updateRuntimeUiState,
    userId,
    videoSubMode,
  ])

  return {
    completeSessionForStream,
    createNewChat,
    handleSend,
  }
}
