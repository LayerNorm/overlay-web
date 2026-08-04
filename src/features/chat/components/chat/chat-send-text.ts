import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { AUTOMATIONS_UPDATED_EVENT } from '@overlay/app-core/automations'
import { createConversationUiState } from '@overlay/chat-core'
import type { ReasoningLevel } from '@overlay/chat-core'
import { markTtftClientMilestone, setTtftClientTurnId } from '@/shared/chat/ttft-client-debug'
import type {
  ConversationRuntime,
  ConversationUiState,
} from '../chat-interface/types'
import { resetRuntimeState } from './conversation-runtime-utils'
import { prepareAskModelThreadsForTextTurn } from './chat-runtime-helpers'
import {
  reportTextStreamError,
  startActTextStream,
} from '../useChatTransport'
import {
  buildCommonActBody,
  buildTextTurnPayload,
  PENDING_FIRST_CHAT_ID,
  TEMPORARY_CHAT_ID,
  type CompleteSession,
  type EnsureConversationRuntime,
  type ReplyContext,
  type SubmittedComposerSnapshot,
  type StartSession,
  type UpdateRuntimeUiState,
} from './chat-send-body-builders'
import type { PendingFirstSendState } from './chat-send-pending-first'
import type { CreateNewChatOptions } from './chat-send-create'

export function sendTextTurn({
  activeChatId,
  activeChatIdRef,
  applyUiStateToView,
  automationIdParam,
  completeSessionForStream,
  createNewChat,
  embedProjectId,
  knowledgeBaseId,
  reasoning,
  emptyRuntime,
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
  replyContext,
  selectedActModelSnapshot,
  setComposerNotice,
  setIsFirstMessage,
  setRuntimeHydrationVersion,
  snapshot,
  startFirstMessageRename,
  startSession,
  updateRuntimeUiState,
}: {
  activeChatId: string | null
  activeChatIdRef: MutableRefObject<string | null>
  applyUiStateToView: (ui: ConversationUiState) => void
  automationIdParam: string | null
  completeSessionForStream: CompleteSession
  createNewChat: (options?: CreateNewChatOptions) => Promise<string | null>
  embedProjectId: string | null
  knowledgeBaseId?: string
  emptyRuntime: ConversationRuntime
  ensureConversationRuntime: EnsureConversationRuntime
  isFirstMessage: boolean
  isStreamChatActive: (chatId: string, temporaryChatSnapshot: boolean) => boolean
  loadChats: () => Promise<void>
  loadSubscription: () => Promise<unknown>
  markChatModified: (chatId: string, titleSnapshot?: string | null) => void
  pendingFirstSendRef: MutableRefObject<PendingFirstSendState | null>
  pendingScrollChatIdRef: MutableRefObject<string | null>
  pendingScrollTurnIdRef: MutableRefObject<string | null>
  refreshSelectedAutomation: (options?: { showLoading?: boolean }) => Promise<void>
  replyContext: ReplyContext
  selectedActModelSnapshot: string
  reasoning?: ReasoningLevel
  setComposerNotice: Dispatch<SetStateAction<string | null>>
  setIsFirstMessage: (isFirstMessage: boolean) => void
  setRuntimeHydrationVersion: Dispatch<SetStateAction<number>>
  snapshot: SubmittedComposerSnapshot
  startFirstMessageRename: (chatId: string, seedText: string) => void
  startSession: StartSession
  updateRuntimeUiState: UpdateRuntimeUiState
}) {
  const textTurnId = crypto.randomUUID()
  setTtftClientTurnId(textTurnId)
  const payload = buildTextTurnPayload({
    text: snapshot.text,
    attachedImages: snapshot.attachedImagesSnapshot,
    pendingChatDocuments: snapshot.pendingChatDocumentsSnapshot,
    mentions: snapshot.mentionsSnapshot,
    replyContext,
    turnId: textTurnId,
  })

  const multiText = snapshot.textModelsForTurn.length > 1
  const textSlotCount = Math.min(4, snapshot.textModelsForTurn.length)
  let msgCountBeforeSend = 0
  let preparedFirstSendRuntime = false
  let textHistoryBaseModelId: string | undefined

  const prepareTextRuntime = (runtime: ConversationRuntime) => {
    textHistoryBaseModelId = prepareAskModelThreadsForTextTurn(
      runtime,
      snapshot.textModelsForTurn,
    ).historyBaseModelId
    msgCountBeforeSend = runtime.askChats[0].messages.length
    const ui = runtime.ui
    runtime.ui = createConversationUiState({
      ...ui,
      exchangeModes: [...ui.exchangeModes, 'act'],
      exchangeModels: [...ui.exchangeModels, [...snapshot.textModelsForTurn]],
      selectedTabPerExchange: [...ui.selectedTabPerExchange, 0],
      exchangeGenTypes: [...ui.exchangeGenTypes, 'text'],
      isFirstMessage: false,
    })
    for (let slot = 0; slot < textSlotCount; slot += 1) {
      runtime.askChats[slot]!.messages = [
        ...runtime.askChats[slot]!.messages,
        payload.userUIMessage as UIMessage,
      ]
    }
    if (!multiText) {
      runtime.actChat.messages = [
        ...runtime.actChat.messages,
        payload.userUIMessage as UIMessage,
      ]
    }
  }

  const existingChatId = snapshot.temporaryChatSnapshot
    ? TEMPORARY_CHAT_ID
    : (activeChatIdRef.current ?? activeChatId)
  pendingScrollTurnIdRef.current = textTurnId
  pendingScrollChatIdRef.current = snapshot.temporaryChatSnapshot ? null : existingChatId
  let chatId = existingChatId
  let targetRuntime: ConversationRuntime
  if (snapshot.temporaryChatSnapshot) {
    targetRuntime = emptyRuntime
    prepareTextRuntime(targetRuntime)
    targetRuntime.hydrated = true
    applyUiStateToView(targetRuntime.ui)
    setIsFirstMessage(false)
    setRuntimeHydrationVersion((value) => value + 1)
  } else if (!existingChatId) {
    const previewRuntime = emptyRuntime
    resetRuntimeState(previewRuntime, {
      selectedActModel: selectedActModelSnapshot,
      selectedModels: snapshot.textModelsForTurn,
      askModelSelectionMode: snapshot.textModelsForTurn.length > 1 ? 'multiple' : 'single',
      activeChatTitle: snapshot.activeChatTitleSnapshot ?? null,
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
      wasFirst: isFirstMessage,
      renameSeed: snapshot.text || payload.indexedFileNames[0] || 'Documents',
      activeChatTitleSnapshot: snapshot.activeChatTitleSnapshot,
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
  if (!snapshot.temporaryChatSnapshot && chatId !== PENDING_FIRST_CHAT_ID) {
    markChatModified(chatId, snapshot.activeChatTitleSnapshot)
  }

  if (
    !snapshot.temporaryChatSnapshot &&
    chatId !== PENDING_FIRST_CHAT_ID &&
    isFirstMessage &&
    (snapshot.text || payload.indexedFileNames.length > 0)
  ) {
    startFirstMessageRename(chatId, snapshot.text || payload.indexedFileNames[0] || 'Documents')
  }

  if (!snapshot.temporaryChatSnapshot && chatId !== PENDING_FIRST_CHAT_ID) {
    activeChatIdRef.current = chatId
  }

  if (!snapshot.temporaryChatSnapshot && !preparedFirstSendRuntime) {
    textHistoryBaseModelId = prepareAskModelThreadsForTextTurn(
      targetRuntime,
      snapshot.textModelsForTurn,
    ).historyBaseModelId
    msgCountBeforeSend = targetRuntime.askChats[0].messages.length
    updateRuntimeUiState(chatId, (prev) => ({
      ...prev,
      exchangeModes: [...prev.exchangeModes, 'act'],
      exchangeModels: [...prev.exchangeModels, [...snapshot.textModelsForTurn]],
      selectedTabPerExchange: [...prev.selectedTabPerExchange, 0],
      exchangeGenTypes: [...prev.exchangeGenTypes, 'text'],
      isFirstMessage: false,
    }))

    for (let slot = 0; slot < textSlotCount; slot += 1) {
      targetRuntime.askChats[slot]!.messages = [
        ...targetRuntime.askChats[slot]!.messages,
        payload.userUIMessage as UIMessage,
      ]
    }
    if (!multiText) {
      targetRuntime.actChat.messages = [
        ...targetRuntime.actChat.messages,
        payload.userUIMessage as UIMessage,
      ]
    }
  }

  startSession(
    chatId,
    'act',
    snapshot.temporaryChatSnapshot ? 'Temporary chat' : snapshot.activeChatTitleSnapshot ?? '',
    msgCountBeforeSend,
  )
  setIsFirstMessage(false)

  const commonActBody = buildCommonActBody({
    chatId,
    pendingConversationClientId:
      chatId === PENDING_FIRST_CHAT_ID
        ? pendingFirstSendRef.current!.conversationClientId
        : null,
    temporaryChatSnapshot: snapshot.temporaryChatSnapshot,
    embedProjectId,
    knowledgeBaseId,
    textModelsForTurn: snapshot.textModelsForTurn,
    turnId: textTurnId,
    requestMode: snapshot.requestMode,
    automationIdParam,
    indexedFileNames: payload.indexedFileNames,
    indexedAttachments: payload.indexedAttachments,
    replyContext,
    userMeta: payload.userMeta,
    textHistoryBaseModelId,
    selectedToolIdsSnapshot: snapshot.selectedToolIdsSnapshot,
    memoryEnabledSnapshot: snapshot.memoryEnabledSnapshot,
    reasoning,
  })

  const refreshAfterActTextTurn = async () => {
    await loadSubscription()
    if (snapshot.requestMode === 'automate' && automationIdParam) {
      await refreshSelectedAutomation({ showLoading: false })
      window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
    }
  }

  startActTextStream({
    chatId,
    targetRuntime,
    textModelsForTurn: snapshot.textModelsForTurn,
    textSlotCount,
    selectedActModel: selectedActModelSnapshot,
    turnId: textTurnId,
    partsForModel: payload.partsForModel,
    userMetadata: payload.userMetadata,
    commonBody: commonActBody,
    isChatActive: (id) => isStreamChatActive(id, snapshot.temporaryChatSnapshot),
    completeSession: completeSessionForStream,
    loadChats: snapshot.temporaryChatSnapshot ? (() => {}) : loadChats,
    loadSubscription: refreshAfterActTextTurn,
    onError: (error, fallbackMessage) => reportTextStreamError(setComposerNotice, error, fallbackMessage),
    logPrefix: multiText ? 'Act multi' : 'Act',
  })
}
