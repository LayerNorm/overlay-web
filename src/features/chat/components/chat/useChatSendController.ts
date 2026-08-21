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
import type { ReasoningLevel } from '@overlay/chat-core'
import {
  beginTtftClientTurn,
} from '@/shared/chat/ttft-client-debug'
import type { MentionInputHandle } from '../chat-interface/MentionInput'
import type {
  AskModelSelectionMode,
  AttachedImage,
  Conversation,
  ConversationRuntime,
  ConversationUiState,
  PendingChatDocument,
} from '../chat-interface/types'
import {
  buildSubmittedComposerSnapshot,
  getSendValidationError,
  PENDING_FIRST_CHAT_ID,
  type CompleteSession,
  type ReplyContext,
  type StartSession,
} from './chat-send-body-builders'
import {
  activatePendingFirstSend,
  completeSessionForPendingFirstSend,
  isStreamChatActive as isPendingAwareStreamChatActive,
  showPendingFirstSendSaveFailure,
  type PendingFirstSendState,
} from './chat-send-pending-first'
import {
  createNewChatForSend,
  type CreateNewChatOptions,
} from './chat-send-create'
import { sendMediaTurn } from './chat-send-media'
import { sendTextTurn } from './chat-send-text'

export { TEMPORARY_CHAT_ID, PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'

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
  personalChatMode,
  persistActiveRuntimeUiState,
  refreshSelectedAutomation,
  replaceConversationRuntime,
  replyContext,
  requireAuth,
  resetComposerToolIds,
  reasoning,
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
  prefetchFirstMessageTitle,
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
  personalChatMode: 'chat' | 'work'
  persistActiveRuntimeUiState: () => void
  refreshSelectedAutomation: (options?: { showLoading?: boolean; conversationId?: string }) => Promise<void>
  replaceConversationRuntime: (
    chatId: string,
    uiSnapshot: ConversationUiState,
    askMessages: UIMessage[][],
    actMessages: UIMessage[],
  ) => ConversationRuntime
  replyContext: ReplyContext
  requireAuth: (reason: 'send') => void
  resetComposerToolIds: (temporary: boolean) => void
  reasoning?: ReasoningLevel
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
  prefetchFirstMessageTitle: (seedText: string) => void
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
  ) => isPendingAwareStreamChatActive({
    activeChatIdRef,
    chatId,
    isTemporaryChatRef,
    pendingFirstSendRef,
    temporaryChatSnapshot,
  }), [activeChatIdRef, isTemporaryChatRef])

  const tryActivatePendingFirstSend = useCallback(() => {
    activatePendingFirstSend({
      activeChatIdRef,
      applyUiStateToView,
      emptyRuntime: emptyRuntimeRef.current,
      markChatModified,
      pendingFirstSendRef,
      replaceConversationRuntime,
      setActiveChatId,
      setActiveViewer,
      setRuntimeHydrationVersion,
      startFirstMessageRename,
      syncStandaloneChatUrl,
    })
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
    return createNewChatForSend({
      activeChatIdRef,
      applyUiStateToView,
      askModelSelectionMode,
      clearTransientComposerState,
      embedProjectId,
      emptyRuntime: emptyRuntimeRef.current,
      ensureConversationRuntime,
      invalidateLoadChatRequest,
      mode,
      options,
      pendingFirstSendRef,
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
    })
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
      completeSessionForPendingFirstSend({
        completeSession,
        createDeferredChat: (conversationClientId) => {
          void createNewChat({
            clientId: conversationClientId,
            deferActivation: true,
          }).catch(() => showPendingFirstSendSaveFailure(setComposerNotice))
        },
        pendingFirstSendRef,
        tryActivatePendingFirstSend,
      })
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
    const snapshot = buildSubmittedComposerSnapshot({
      askModelSelectionMode,
      selectedModels,
      selectedActModel,
      activeChatTitle,
      selectedImageModels,
      selectedVideoModels,
      attachedImages,
      pendingChatDocuments,
      mentions,
      isTemporaryChat,
      mode,
      selectedToolIds,
      memoryEnabled,
      text: inputRef.current.trim(),
    })
    const clearSubmittedComposer = () => {
      textareaRef.current?.clear()
      setInput('')
      setMentions([])
      setAttachedImages([])
      setPendingChatDocuments([])
      setAttachmentError(null)
      setReplyContext(null)
      resetComposerToolIds(snapshot.temporaryChatSnapshot)
    }
    if (isActiveLoading) return

    const sendValidationError = getSendValidationError(snapshot, effectiveGenType)
    if (sendValidationError === 'uploading-documents') {
      setAttachmentError('Wait for documents to finish indexing.')
      return
    }
    if (sendValidationError === 'failed-documents') {
      setAttachmentError('Remove failed documents before sending.')
      return
    }
    if (sendValidationError === 'empty') return
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
      has_attachments: snapshot.attachedImagesSnapshot.length > 0 || snapshot.pendingChatDocumentsSnapshot.length > 0,
      is_first_message: isFirstMessage,
    })

    beginTtftClientTurn({
      model: snapshot.selectedActModelSnapshot,
      isFirstMessage,
    })
    setIsOptimisticLoading(true)

    // Title generation runs alongside the message, not after it: a long turn
    // would otherwise leave the chat named "New Chat" until the run finished.
    if (isFirstMessage && !snapshot.temporaryChatSnapshot && snapshot.text.trim()) {
      prefetchFirstMessageTitle(snapshot.text)
    }

    if (effectiveGenType === 'image' || effectiveGenType === 'video') {
      clearSubmittedComposer()
      await sendMediaTurn({
        activeChatId,
        activeChatIdRef,
        applyUiStateToView,
        completeSession,
        createNewChat,
        effectiveGenType,
        emptyRuntime: emptyRuntimeRef.current,
        ensureConversationRuntime,
        isFreeTier,
        isFirstMessage,
        isTemporaryChatRef,
        loadChats,
        loadSubscription,
        markChatModified,
        pendingScrollChatIdRef,
        pendingScrollTurnIdRef,
        replyContext: replyCtxSnapshot,
        selectedActModel,
        setGenerationChip,
        setIsFirstMessage,
        setRuntimeHydrationVersion,
        snapshot,
        startFirstMessageRename,
        startSession,
        updateRuntimeUiState,
        videoSubMode,
      })
      return
    }

    clearSubmittedComposer()
    sendTextTurn({
      activeChatId,
      activeChatIdRef,
      applyUiStateToView,
      automationIdParam,
      completeSessionForStream,
      createNewChat,
      embedProjectId,
      emptyRuntime: emptyRuntimeRef.current,
      ensureConversationRuntime,
      isFirstMessage,
      isStreamChatActive,
      loadChats,
      loadSubscription,
      markChatModified,
      pendingFirstSendRef,
      pendingScrollChatIdRef,
      pendingScrollTurnIdRef,
      refreshSelectedAutomation,
      replyContext: replyCtxSnapshot,
      selectedActModelSnapshot: snapshot.selectedActModelSnapshot,
      reasoning,
      personalChatMode,
      setComposerNotice,
      setIsFirstMessage,
      setRuntimeHydrationVersion,
      snapshot,
      startFirstMessageRename,
      startSession,
      updateRuntimeUiState,
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
    personalChatMode,
    refreshSelectedAutomation,
    replyContext,
    requireAuth,
    resetComposerToolIds,
    reasoning,
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
    prefetchFirstMessageTitle,
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
