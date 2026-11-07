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
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { MentionItem } from '@/shared/knowledge/mention-types'
import type { ChatToolRequestId } from '@/shared/chat/tool-requests'
import type { ChatModel, VideoSubMode } from '@/shared/ai/gateway/model-types'
import { getEffectiveReasoningByModel } from '@overlay/chat-core'
import type { ReasoningLevel } from '@overlay/chat-core'
import {
  beginTtftClientTurn,
} from '@/shared/chat/ttft-client-debug'
import type { MentionInputHandle } from '../chat-interface/MentionInput'
import type {
  AttachedImage,
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
  createNativePersonalChat,
  addAssistantNote,
  billingAccessNotice,
  isBudgetExhaustedPaid,
  connectionUnavailable,
  isFirstMessage,
  isSendBlocked,
  premiumModelBlocked,
  isTemporaryChat,
  isTemporaryChatRef,
  loadSubscription,
  nativePersonalEnabled = false,
  nativePersonalRoute = false,
  nativeOwnerId,
  nativeWorkspaceId,
  submitNativePersonalTurn,
  setPendingTranscriptConversation,
  onUsageExhaustedError,
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
  reasoningByModel,
  reasoningModels,
  selectedActModel,
  selectedImageModels,
  selectedModels,
  selectedToolIds,
  selectedVideoModels,
  setActiveChatId,
  setActiveViewer,
  setAttachedImages,
  setAttachmentError,
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
  workspaceId,
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
  createNativePersonalChat?: Parameters<typeof createNewChatForSend>[0]['createNativePersonalChat']
  addAssistantNote?: (chatId: string, turnId: string, text: string) => Promise<void>
  billingAccessNotice: string | null
  isBudgetExhaustedPaid: boolean
  connectionUnavailable: boolean
  isFirstMessage: boolean
  isSendBlocked: boolean
  premiumModelBlocked: boolean
  isTemporaryChat: boolean
  isTemporaryChatRef: MutableRefObject<boolean>
  loadSubscription: () => Promise<unknown>
  nativePersonalEnabled?: boolean
  nativePersonalRoute?: boolean
  nativeOwnerId?: string | null
  nativeWorkspaceId?: string | null
  submitNativePersonalTurn?: Parameters<typeof sendTextTurn>[0]['submitNativePersonalTurn']
  setPendingTranscriptConversation?: Parameters<typeof sendTextTurn>[0]['setPendingTranscriptConversation']
  onUsageExhaustedError: (message: string) => boolean
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
  reasoningByModel: Readonly<Record<string, ReasoningLevel | undefined>>
  reasoningModels: readonly Pick<ChatModel, 'id' | 'reasoningLevels'>[]
  selectedActModel: string
  selectedImageModels: string[]
  selectedModels: string[]
  selectedToolIds: ChatToolRequestId[]
  selectedVideoModels: string[]
  setActiveChatId: (chatId: string | null) => void
  setActiveViewer: (chatId: string | null) => void
  setAttachedImages: Dispatch<SetStateAction<AttachedImage[]>>
  setAttachmentError: (error: string | null) => void
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
  startFirstMessageRename: (chatId: string, seedText: string, nativePersonalOwner?: boolean) => void
  startSession: StartSession
  syncStandaloneChatUrl: (chatId: string | null) => void
  textareaRef: RefObject<MentionInputHandle | null>
  updateRuntimeUiState: (
    chatId: string,
    updater: (prev: ConversationUiState) => ConversationUiState,
  ) => void
  userId: string | null
  videoSubMode: VideoSubMode
  workspaceId?: string | null
}) {
  const effectiveReasoningByModel = useMemo(
    () => getEffectiveReasoningByModel(reasoningModels, reasoningByModel),
    [reasoningByModel, reasoningModels],
  )
  const preflightInFlight = useRef(false)
  const sendIntentGeneration = useRef(0)
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
      createNativePersonalChat,
      invalidateLoadChatRequest,
      isCurrentScope,
      mode,
      nativePersonalEnabled,
      nativePersonalRoute,
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
      setInterruptedExchangeIdx,
      setIsTemporaryChat,
      setPendingRunConversationId,
      setRuntimeHydrationVersion,
      syncStandaloneChatUrl,
      startFirstMessageRename,
      tryActivatePendingFirstSend,
      workspaceId,
    })
  }, [
    activeChatIdRef,
    applyUiStateToView,
    clearTransientComposerState,
    emptyRuntimeRef,
    ensureConversationRuntime,
    createNativePersonalChat,
    invalidateLoadChatRequest,
    isCurrentScope,
    mode,
    nativePersonalEnabled,
    nativePersonalRoute,
    pendingFirstSendRef,
    pendingScrollChatIdRef,
    pendingScrollTurnIdRef,
    persistActiveRuntimeUiState,
    resetComposerToolIds,
    selectedActModel,
    selectedModels,
    setActiveChatId,
    setActiveViewer,
    setInterruptedExchangeIdx,
    setIsTemporaryChat,
    setPendingRunConversationId,
    setRuntimeHydrationVersion,
    syncStandaloneChatUrl,
    startFirstMessageRename,
    tryActivatePendingFirstSend,
    workspaceId,
  ])

  const completeSessionForStream = useCallback((chatId: string, active: boolean) => {
    if (chatId === PENDING_FIRST_CHAT_ID) {
      completeSessionForPendingFirstSend({
        completeSession,
        createDeferredChat: (conversationClientId) => {
          void createNewChat({
            clientId: conversationClientId,
            deferActivation: true,
            reasoningByModelSnapshot: pendingFirstSendRef.current?.reasoningByModelSnapshot,
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
      if (billingAccessNotice) return
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
    const sendIntentId = ++sendIntentGeneration.current
    preflightInFlight.current = true
    let writable = false
    try {
      writable = await ensureWritable()
    } catch {
      writable = false
    } finally {
      preflightInFlight.current = false
    }
    const isCurrentSendScope = () => isCurrentScope()
      && (!nativePersonalEnabled || sendIntentGeneration.current === sendIntentId)
    function sendIntentChanged() {
      return !isCurrentSendScope()
      || activeChatIdRef.current !== originalChatId
      || isTemporaryChatRef.current !== originalTemporary
      || inputRef.current !== submittedInput
      || latestComposerStateRef.current !== submittedComposerState
    }
    if (!writable || sendIntentChanged()) return

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

    function restoreFailedSubmission() {
      if (!isCurrentSendScope() || activeChatIdRef.current !== originalChatId) return
      setIsOptimisticLoading(false)
      setComposerNotice('Could not save your message. Retry to send it.')
      const currentComposer = latestComposerStateRef.current
      if (
        inputRef.current === ''
        && currentComposer.attachedImages.length === 0
        && currentComposer.pendingChatDocuments.length === 0
        && currentComposer.mentions.length === 0
        && !currentComposer.replyContext
      ) {
        setInput(submittedInput)
        setAttachedImages(snapshot.attachedImagesSnapshot)
        setPendingChatDocuments(snapshot.pendingChatDocumentsSnapshot)
        setMentions(snapshot.mentionsSnapshot)
        setReplyContext(replyCtxSnapshot)
      }
    }

    if (effectiveGenType === 'image' || effectiveGenType === 'video') {
      clearSubmittedComposer()
      try {
        await sendMediaTurn({
          activeChatId,
          activeChatIdRef,
          applyUiStateToView,
          completeSession,
          createNewChat,
          effectiveGenType,
          emptyRuntime: emptyRuntimeRef.current,
          ensureConversationRuntime,
          isSendBlocked,
          isFirstMessage,
          isTemporaryChatRef,
          loadSubscription,
          nativePersonalEnabled,
          nativePersonalRoute,
          nativeOwnerId,
          nativeWorkspaceId,
          submitNativePersonalTurn,
          setPendingTranscriptConversation,
          addAssistantNote,
          isCurrentScope: isCurrentSendScope,
          isStreamChatActive,
          pendingFirstSendRef,
          completeSessionForStream,
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
      } catch {
        restoreFailedSubmission()
      }
      return
    }

    clearSubmittedComposer()
    try {
      await sendTextTurn({
        activeChatId,
        activeChatIdRef,
        applyUiStateToView,
        automationIdParam,
        completeSessionForStream,
        createNewChat,
        emptyRuntime: emptyRuntimeRef.current,
        ensureConversationRuntime,
        isFirstMessage,
        isCurrentScope: isCurrentSendScope,
        isStreamChatActive,
        loadSubscription,
        nativePersonalEnabled,
        nativePersonalRoute,
        nativeOwnerId,
        nativeWorkspaceId,
        submitNativePersonalTurn,
        setPendingTranscriptConversation,
        onUsageExhaustedError,
        pendingFirstSendRef,
        pendingScrollChatIdRef,
        pendingScrollTurnIdRef,
        refreshSelectedAutomation,
        replyContext: replyCtxSnapshot,
        selectedActModelSnapshot: snapshot.selectedActModelSnapshot,
        reasoning: effectiveReasoningByModel[snapshot.selectedActModelSnapshot],
        reasoningByModelSnapshot: effectiveReasoningByModel,
        setIsFirstMessage,
        setRuntimeHydrationVersion,
        snapshot,
        startFirstMessageRename,
        startSession,
        updateRuntimeUiState,
      })
    } catch {
      restoreFailedSubmission()
    }
  }, [
    addAssistantNote,
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
    billingAccessNotice,
    isBudgetExhaustedPaid,
    connectionUnavailable,
    isFirstMessage,
    isSendBlocked,
    premiumModelBlocked,
    isStreamChatActive,
    isTemporaryChat,
    isTemporaryChatRef,
    loadSubscription,
    nativePersonalEnabled,
    nativePersonalRoute,
    nativeOwnerId,
    nativeWorkspaceId,
    submitNativePersonalTurn,
    setPendingTranscriptConversation,
    onUsageExhaustedError,
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
    effectiveReasoningByModel,
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
