'use client'
import { useAsyncSessions } from '@/components/providers/async-sessions-store'

import {
  useCallback,
  useLayoutEffect,
  useMemo,
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
import { getBlockedSendNotice } from './chat-composer-blocking'

export { TEMPORARY_CHAT_ID, PENDING_FIRST_CHAT_ID } from './chat-send-body-builders'

export function useChatSendController({
  ensureWritable,
  isCurrentScope,
  nativeThreadReadOnly = false,
  activeChatId,
  activeChatIdRef,
  activeChatTitle,
  applyUiStateToView,
  attachedImages,
  authUser,
  automationIdParam,
  clearTransientComposerState,
  completeSession,
  effectiveGenType,
  emptyRuntimeRef,
  ensureConversationRuntime,
  inputRef,
  invalidateLoadChatRequest,
  isActiveLoading,
  isBudgetExhaustedPaid,
  connectionUnavailable,
  isFirstMessage,
  isFreeTier,
  isSendBlocked,
  premiumModelBlocked,
  isTemporaryChat,
  isTemporaryChatRef,
  loadChats,
  loadSubscription,
  onUsageExhaustedError,
  markChatModified,
  memoryEnabled,
  mentions,
  mode,
  pendingChatDocuments,
  pendingScrollChatIdRef,
  pendingScrollTurnIdRef,
  persistActiveRuntimeUiState,
  pendingFirstSendRef,
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
  setPendingRunConversationId,
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
  ensureWritable: () => Promise<boolean>
  isCurrentScope: () => boolean
  nativeThreadReadOnly?: boolean
  activeChatId: string | null
  activeChatIdRef: MutableRefObject<string | null>
  activeChatTitle: string | null
  applyUiStateToView: (ui: ConversationUiState) => void
  attachedImages: AttachedImage[]
  authUser: unknown
  automationIdParam: string | null
  clearTransientComposerState: () => void
  completeSession: CompleteSession
  effectiveGenType: 'image' | 'video' | null
  emptyRuntimeRef: MutableRefObject<ConversationRuntime>
  ensureConversationRuntime: (
    chatId: string,
    uiOverrides?: Partial<ConversationUiState>,
  ) => ConversationRuntime
  inputRef: MutableRefObject<string>
  invalidateLoadChatRequest: () => void
  isActiveLoading: boolean
  isBudgetExhaustedPaid: boolean
  connectionUnavailable: boolean
  isFirstMessage: boolean
  isFreeTier: boolean
  isSendBlocked: boolean
  premiumModelBlocked: boolean
  isTemporaryChat: boolean
  isTemporaryChatRef: MutableRefObject<boolean>
  loadChats: () => Promise<void>
  loadSubscription: () => Promise<unknown>
  onUsageExhaustedError: (message: string) => boolean
  markChatModified: (chatId: string, titleSnapshot?: string | null) => void
  memoryEnabled: boolean
  mentions: MentionItem[]
  mode: 'chat' | 'automate'
  pendingChatDocuments: PendingChatDocument[]
  pendingScrollChatIdRef: MutableRefObject<string | null>
  pendingScrollTurnIdRef: MutableRefObject<string | null>
  persistActiveRuntimeUiState: () => void
  pendingFirstSendRef: MutableRefObject<PendingFirstSendState | null>
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
  setPendingRunConversationId: (conversationId: string | null) => void
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
  const preflightInFlight = useRef(false)
  const composerState = useMemo(() => ({ attachedImages, pendingChatDocuments, replyContext, mentions }),
    [attachedImages, pendingChatDocuments, replyContext, mentions])
  const latestComposerStateRef = useRef(composerState)
  useLayoutEffect(() => {
    latestComposerStateRef.current = composerState
  }, [composerState])
  const isStreamChatActive = useCallback((
    chatId: string,
    temporaryChatSnapshot: boolean,
  ) => isPendingAwareStreamChatActive({
    activeChatIdRef,
    chatId,
    isTemporaryChatRef,
    pendingFirstSendRef,
    temporaryChatSnapshot,
  }), [activeChatIdRef, isTemporaryChatRef, pendingFirstSendRef])

  const { resolveSession } = useAsyncSessions()
  const tryActivatePendingFirstSend = useCallback(() => {
    const pending = pendingFirstSendRef.current
    if (pending?.realChatId && pending.streamDone) resolveSession(PENDING_FIRST_CHAT_ID, pending.realChatId)
    activatePendingFirstSend({
      activeChatIdRef,
      applyUiStateToView,
      emptyRuntime: emptyRuntimeRef.current,
      markChatModified,
      pendingFirstSendRef,
      replaceConversationRuntime,
      setActiveChatId,
      setActiveViewer,
      setPendingRunConversationId,
      setRuntimeHydrationVersion,
      startFirstMessageRename,
      syncStandaloneChatUrl,
    })
  }, [
    activeChatIdRef,
    applyUiStateToView,
    emptyRuntimeRef,
    markChatModified,
    pendingFirstSendRef,
    replaceConversationRuntime,
    setActiveChatId,
    setActiveViewer,
    setPendingRunConversationId,
    setRuntimeHydrationVersion,
    startFirstMessageRename,
    syncStandaloneChatUrl,
    resolveSession,
  ])

  const createNewChat = useCallback(async (options: CreateNewChatOptions = {}): Promise<string | null> => {
    return createNewChatForSend({
      activeChatIdRef,
      applyUiStateToView,
      clearTransientComposerState,
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
      setPendingRunConversationId,
      setRuntimeHydrationVersion,
      syncStandaloneChatUrl,
      startFirstMessageRename,
      tryActivatePendingFirstSend,
    })
  }, [
    activeChatIdRef,
    applyUiStateToView,
    clearTransientComposerState,
      emptyRuntimeRef,
    ensureConversationRuntime,
    invalidateLoadChatRequest,
    mode,
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
    setPendingRunConversationId,
    setRuntimeHydrationVersion,
    syncStandaloneChatUrl,
    startFirstMessageRename,
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
          }).catch(() => showPendingFirstSendSaveFailure())
        },
        pendingFirstSendRef,
        tryActivatePendingFirstSend,
      })
      return
    }
    completeSession(chatId, active)
  }, [completeSession, createNewChat, pendingFirstSendRef, tryActivatePendingFirstSend])

  const handleSend = useCallback(async () => {
    if (nativeThreadReadOnly) return
    if (!userId && !authUser) {
      try { sessionStorage.setItem('overlay:guest-draft', inputRef.current) } catch { /* ignore */ }
      requireAuth('send')
      return
    }
    const replyCtxSnapshot = replyContext
    const submittedInput = inputRef.current
    const submittedComposerState = latestComposerStateRef.current
    const snapshot = buildSubmittedComposerSnapshot({
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
      text: submittedInput.trim(),
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
      setComposerNotice(getBlockedSendNotice({
        connectionUnavailable,
        isBudgetExhaustedPaid,
        premiumModelBlocked,
      }))
      return
    }

    if (preflightInFlight.current) return
    const originalChatId = activeChatIdRef.current
    const originalTemporary = isTemporaryChatRef.current
    preflightInFlight.current = true
    let writable = false
    try {
      writable = await ensureWritable()
    } catch {
      writable = false
    } finally {
      preflightInFlight.current = false
    }
    if (
      !writable
      || !isCurrentScope()
      || activeChatIdRef.current !== originalChatId
      || isTemporaryChatRef.current !== originalTemporary
      || inputRef.current !== submittedInput
      || latestComposerStateRef.current !== submittedComposerState
    ) return

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
          emptyRuntime: emptyRuntimeRef.current,
      ensureConversationRuntime,
      isFirstMessage,
      isStreamChatActive,
      loadChats,
      loadSubscription,
      onUsageExhaustedError,
      markChatModified,
      pendingFirstSendRef,
      pendingScrollChatIdRef,
      pendingScrollTurnIdRef,
      refreshSelectedAutomation,
      replyContext: replyCtxSnapshot,
      selectedActModelSnapshot: snapshot.selectedActModelSnapshot,
      reasoning,
      setIsFirstMessage,
      setRuntimeHydrationVersion,
      snapshot,
      startFirstMessageRename,
      startSession,
      updateRuntimeUiState,
    })
  }, [
    nativeThreadReadOnly,
    ensureWritable,
    isCurrentScope,
    activeChatId,
    activeChatIdRef,
    activeChatTitle,
    applyUiStateToView,
    attachedImages,
    authUser,
    automationIdParam,
    completeSession,
    completeSessionForStream,
    createNewChat,
    effectiveGenType,
      emptyRuntimeRef,
    ensureConversationRuntime,
    inputRef,
    isActiveLoading,
    isBudgetExhaustedPaid,
    connectionUnavailable,
    isFirstMessage,
    isFreeTier,
    isSendBlocked,
    premiumModelBlocked,
    isStreamChatActive,
    isTemporaryChat,
    isTemporaryChatRef,
    loadChats,
    loadSubscription,
    onUsageExhaustedError,
    markChatModified,
    memoryEnabled,
    mentions,
    mode,
    pendingChatDocuments,
    pendingScrollChatIdRef,
    pendingScrollTurnIdRef,
    pendingFirstSendRef,
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
