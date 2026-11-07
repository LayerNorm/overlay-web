import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { NativePersonalSubmitArgs } from '@/components/providers/PersonalChatProvider'
import type { PersonalPendingTurn, PersonalTranscriptMessage } from './personal-transcript'
import { AUTOMATIONS_UPDATED_EVENT } from '@overlay/app-core/automations'
import { createConversationUiState } from '@overlay/chat-core'
import type { ReasoningLevel } from '@overlay/chat-core'
import { toast } from '@overlay/ui/primitives'
import { markTtftClientMilestone, setTtftClientTurnId } from '@/shared/chat/ttft-client-debug'
import type {
  ConversationRuntime,
  ConversationUiState,
} from '../chat-interface/types'
import { resetRuntimeState } from './conversation-runtime-utils'
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
import { workspaceChatsViewActive, type CreateNewChatOptions } from './chat-send-create'

function submissionKey(snapshot: SubmittedComposerSnapshot, replyContext: ReplyContext, workspaceId: string | null | undefined, conversationId: string | null) {
  return JSON.stringify([
    workspaceId,
    conversationId,
    snapshot.text,
    snapshot.selectedActModelSnapshot,
    snapshot.textModelsForTurn,
    snapshot.attachedImagesSnapshot.map(image => [image.dataUrl, image.mimeType, image.name]),
    snapshot.pendingChatDocumentsSnapshot.map(document => [document.fileIds, document.name, document.status]),
    snapshot.mentionsSnapshot,
    snapshot.requestMode,
    replyContext,
  ])
}

export async function sendTextTurn({
  activeChatId,
  activeChatIdRef,
  applyUiStateToView,
  automationIdParam,
  completeSessionForStream,
  createNewChat,
  reasoning,
  reasoningByModelSnapshot,
  emptyRuntime,
  ensureConversationRuntime,
  isFirstMessage,
  isCurrentScope,
  isStreamChatActive,
  loadSubscription,
  nativePersonalEnabled = false,
  nativePersonalRoute = false,
  nativeOwnerId,
  nativeWorkspaceId,
  submitNativePersonalTurn,
  setPendingTranscriptConversation,
  onUsageExhaustedError,
  pendingFirstSendRef,
  pendingScrollChatIdRef,
  pendingScrollTurnIdRef,
  refreshSelectedAutomation,
  replyContext,
  selectedActModelSnapshot,
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
  emptyRuntime: ConversationRuntime
  ensureConversationRuntime: EnsureConversationRuntime
  isFirstMessage: boolean
  isCurrentScope: () => boolean
  isStreamChatActive: (chatId: string, temporaryChatSnapshot: boolean) => boolean
  loadSubscription: () => Promise<unknown>
  nativePersonalEnabled?: boolean
  nativePersonalRoute?: boolean
  nativeOwnerId?: string | null
  nativeWorkspaceId?: string | null
  submitNativePersonalTurn?: (args: NativePersonalSubmitArgs) => Promise<{ conversationId: string; messageId: string }>
  setPendingTranscriptConversation?: (conversationId: string | null, ownerId?: string | null, intentKey?: string) => void
  onUsageExhaustedError: (message: string) => boolean
  pendingFirstSendRef: MutableRefObject<PendingFirstSendState | null>
  pendingScrollChatIdRef: MutableRefObject<string | null>
  pendingScrollTurnIdRef: MutableRefObject<string | null>
  refreshSelectedAutomation: (options?: { showLoading?: boolean; conversationId?: string }) => Promise<void>
  replyContext: ReplyContext
  selectedActModelSnapshot: string
  reasoning?: ReasoningLevel
  reasoningByModelSnapshot: Readonly<Record<string, ReasoningLevel | undefined>>
  setIsFirstMessage: (isFirstMessage: boolean) => void
  setRuntimeHydrationVersion: Dispatch<SetStateAction<number>>
  snapshot: SubmittedComposerSnapshot
  startFirstMessageRename: (chatId: string, seedText: string) => void
  startSession: StartSession
  updateRuntimeUiState: UpdateRuntimeUiState
}) {
  const existingChatId = snapshot.temporaryChatSnapshot
    ? TEMPORARY_CHAT_ID
    : (activeChatIdRef.current ?? activeChatId)
  const nativeSubmitEnabled = nativePersonalEnabled && nativePersonalRoute && !snapshot.temporaryChatSnapshot
  const retryRuntime = existingChatId ? ensureConversationRuntime(existingChatId) : emptyRuntime
  const attemptKey = submissionKey(snapshot, replyContext, nativeWorkspaceId, existingChatId)
  const previousNativeAttempt = nativeSubmitEnabled
    ? [...(retryRuntime.nativePendingTurns?.values() ?? [])].find(turn =>
        turn.ownerId === nativeOwnerId && turn.workspaceId === nativeWorkspaceId
        && turn.submissionKey === attemptKey && turn.submitArgs)
    : undefined
  const textTurnId = previousNativeAttempt?.turnId ?? crypto.randomUUID()
  setTtftClientTurnId(textTurnId)
  const payload = buildTextTurnPayload({
    text: snapshot.text,
    attachedImages: snapshot.attachedImagesSnapshot,
    pendingChatDocuments: snapshot.pendingChatDocumentsSnapshot,
    mentions: snapshot.mentionsSnapshot,
    replyContext,
    turnId: textTurnId,
  })

  const effectiveTextModelsForTurn = [snapshot.textModelsForTurn[0] ?? selectedActModelSnapshot]
  let msgCountBeforeSend = 0
  let preparedFirstSendRuntime = false
  const prepareTextRuntime = (runtime: ConversationRuntime) => {
    msgCountBeforeSend = runtime.askChats[0].messages.length
    const ui = runtime.ui
    runtime.ui = createConversationUiState({
      ...ui,
      exchangeModes: [...ui.exchangeModes, 'act'],
      exchangeModels: [...ui.exchangeModels, [...effectiveTextModelsForTurn]],
      exchangeGenTypes: [...ui.exchangeGenTypes, 'text'],
      isFirstMessage: false,
    })
    runtime.askChats[0].messages = [
      ...runtime.askChats[0].messages,
      ...(!runtime.askChats[0].messages.some(message => message.id === payload.userUIMessage.id)
        ? [payload.userUIMessage as UIMessage]
        : []),
    ]
    runtime.actChat.messages = [
      ...runtime.actChat.messages,
      ...(!runtime.actChat.messages.some(message => message.id === payload.userUIMessage.id)
        ? [payload.userUIMessage as UIMessage]
        : []),
    ]
  }

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
      selectedModels: effectiveTextModelsForTurn,
      activeChatTitle: snapshot.activeChatTitleSnapshot ?? null,
      isFirstMessage: false,
    })
    prepareTextRuntime(previewRuntime)
    previewRuntime.hydrated = true
    applyUiStateToView(previewRuntime.ui)
    setIsFirstMessage(false)
    setRuntimeHydrationVersion((value) => value + 1)

    const conversationClientId = typeof previousNativeAttempt?.submitArgs?.clientId === 'string'
      ? previousNativeAttempt.submitArgs.clientId
      : crypto.randomUUID()
    pendingFirstSendRef.current = {
      conversationClientId,
      previewRuntime,
      streamDone: false,
      realChatId: null,
      wasFirst: isFirstMessage,
      renameStarted: false,
      renameSeed: snapshot.text || payload.indexedFileNames[0] || 'Documents',
      activeChatTitleSnapshot: snapshot.activeChatTitleSnapshot,
      reasoningByModelSnapshot,
      nativePersonalOwner: nativePersonalEnabled && !workspaceChatsViewActive(),
    }
    chatId = PENDING_FIRST_CHAT_ID
    targetRuntime = previewRuntime
    preparedFirstSendRuntime = true

    if (!nativeSubmitEnabled) {
      void createNewChat({
        clientId: conversationClientId,
        deferActivation: true,
        reasoningByModelSnapshot,
      }).catch(() => {
        toast.error('Could not create chat. Your reply may still stream.')
      })
      markTtftClientMilestone('create_started', { conversationClientId })
    }
  } else {
    targetRuntime = ensureConversationRuntime(existingChatId)
  }
  if (!chatId) return
  let pendingNativeTurn: PersonalPendingTurn | undefined
  let nativeSubmittedConversationId: string | null = null
  if (nativeSubmitEnabled) {
    const user = {
      ...payload.userUIMessage,
      id: textTurnId,
      turnId: textTurnId,
      mode: 'act',
      contentType: 'text',
      createdAt: Date.now(),
    } as PersonalTranscriptMessage
    pendingNativeTurn = {
      turnId: textTurnId,
      user: previousNativeAttempt?.user ?? user,
      responses: [],
      userAcknowledged: previousNativeAttempt?.userAcknowledged ?? false,
      ownerId: nativeOwnerId ?? undefined,
      workspaceId: nativeWorkspaceId ?? undefined,
      submissionKey: attemptKey,
      submitArgs: previousNativeAttempt?.submitArgs,
    }
    targetRuntime.nativePendingTurns ??= new Map()
    targetRuntime.nativePendingTurns.set(textTurnId, pendingNativeTurn)
    setRuntimeHydrationVersion((value) => value + 1)
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
    msgCountBeforeSend = targetRuntime.askChats[0].messages.length
    updateRuntimeUiState(chatId, (prev) => ({
      ...prev,
      exchangeModes: [...prev.exchangeModes, 'act'],
      exchangeModels: [...prev.exchangeModels, [...effectiveTextModelsForTurn]],
      exchangeGenTypes: [...prev.exchangeGenTypes, 'text'],
      isFirstMessage: false,
    }))

    targetRuntime.askChats[0].messages = [
      ...targetRuntime.askChats[0].messages,
      payload.userUIMessage as UIMessage,
    ]
    targetRuntime.actChat.messages = [
      ...targetRuntime.actChat.messages,
      payload.userUIMessage as UIMessage,
    ]
  }

  const transportParts = payload.partsForModel.length > 0
    ? payload.partsForModel
    : payload.indexedFileNames.length > 0
      ? [{ type: 'text' as const, text: '[Attached documents]' }]
      : payload.partsForModel
  if (nativeSubmitEnabled && pendingNativeTurn) {
    const pendingIntent = pendingFirstSendRef.current
    const isCurrentSend = () => isCurrentScope()
      && isStreamChatActive(chatId, snapshot.temporaryChatSnapshot)
      && (chatId !== PENDING_FIRST_CHAT_ID || pendingFirstSendRef.current === pendingIntent)
    const conversationClientId = pendingFirstSendRef.current?.conversationClientId
    const nativeArgs = (previousNativeAttempt?.submitArgs as NativePersonalSubmitArgs | undefined) ?? {
      workspaceId: nativeWorkspaceId!,
      ...(existingChatId ? { conversationId: existingChatId as NativePersonalSubmitArgs['conversationId'] } : {}),
      ...(!existingChatId ? {
        clientId: conversationClientId!,
        title: snapshot.activeChatTitleSnapshot ?? 'New conversation',
        scope: workspaceChatsViewActive() ? 'workspace' as const : 'personal' as const,
      } : {}),
      turnId: textTurnId,
      mode: 'act' as const,
      modelId: effectiveTextModelsForTurn[0]!,
      contentType: 'text' as const,
      parts: transportParts as NativePersonalSubmitArgs['parts'],
      attachmentNames: payload.indexedFileNames,
      userMetadata: payload.userMetadata ? {
        ...(payload.userMetadata.indexedDocuments
          ? { indexedDocuments: payload.userMetadata.indexedDocuments }
          : {}),
        ...(payload.userMetadata.indexedAttachments
          ? { indexedAttachments: payload.userMetadata.indexedAttachments }
          : {}),
        ...(payload.userMetadata.mentions ? { mentions: payload.userMetadata.mentions } : {}),
      } : undefined,
      ...(replyContext?.replyToTurnId
        ? { replyToTurnId: replyContext.replyToTurnId, replySnippet: replyContext.snippet }
        : {}),
    }
    pendingNativeTurn.submitArgs = nativeArgs as unknown as Record<string, unknown>
    try {
      if (!nativeWorkspaceId || !submitNativePersonalTurn) throw new Error('Native personal chat is unavailable')
      const submitted = await submitNativePersonalTurn(nativeArgs)
      if (!isCurrentSend()) return
      nativeSubmittedConversationId = submitted.conversationId
      if (!existingChatId) {
        const realChatId = await createNewChat({
          clientId: typeof nativeArgs.clientId === 'string' ? nativeArgs.clientId : conversationClientId,
          deferActivation: true,
          persistedChatId: submitted.conversationId,
          reasoningByModelSnapshot,
        })
        if (!realChatId) throw new Error('Could not activate native personal chat')
        if (!isCurrentSend()) return
        setPendingTranscriptConversation?.(realChatId, nativeOwnerId, textTurnId)
      }
    } catch (error) {
      if (!isCurrentSend()) return
      if (isCurrentScope() && isStreamChatActive(chatId, snapshot.temporaryChatSnapshot)) {
        pendingNativeTurn.responses = [{
          id: `native-submit-error:${textTurnId}`,
          turnId: textTurnId,
          role: 'assistant',
          mode: 'act',
          model: effectiveTextModelsForTurn[0],
          variantIndex: 0,
          createdAt: Date.now(),
          contentType: 'text',
          status: 'error',
          parts: [{ type: 'text', text: 'Message could not be saved. Retry to send.' }],
        } as PersonalTranscriptMessage]
        if (pendingFirstSendRef.current?.conversationClientId === conversationClientId) {
          pendingFirstSendRef.current = null
        }
        setPendingTranscriptConversation?.(null, nativeOwnerId, textTurnId)
        setRuntimeHydrationVersion((value) => value + 1)
      }
      throw error
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
    scope: workspaceChatsViewActive() ? 'workspace' : 'personal',
    chatId: nativeSubmittedConversationId ?? chatId,
    pendingConversationClientId:
      chatId === PENDING_FIRST_CHAT_ID && !nativeSubmittedConversationId
        ? pendingFirstSendRef.current!.conversationClientId
        : null,
    temporaryChatSnapshot: snapshot.temporaryChatSnapshot,
    textModelsForTurn: effectiveTextModelsForTurn,
    turnId: textTurnId,
    requestMode: snapshot.requestMode,
    automationIdParam,
    indexedFileNames: payload.indexedFileNames,
    indexedAttachments: payload.indexedAttachments,
    replyContext,
    userMeta: payload.userMeta,
    selectedToolIdsSnapshot: snapshot.selectedToolIdsSnapshot,
    memoryEnabledSnapshot: snapshot.memoryEnabledSnapshot,
    reasoning,
  })

  const refreshAfterActTextTurn = async () => {
    await loadSubscription()
    if (snapshot.requestMode !== 'automate') return
    await refreshSelectedAutomation({
      showLoading: false,
      conversationId: activeChatIdRef.current ?? undefined,
    })
    window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
  }

  startActTextStream({
    chatId,
    targetRuntime,
    textModelsForTurn: effectiveTextModelsForTurn,
    selectedActModel: selectedActModelSnapshot,
    turnId: textTurnId,
    partsForModel: transportParts,
    userMetadata: payload.userMetadata,
    commonBody: commonActBody,
    isChatActive: (id) => isStreamChatActive(id, snapshot.temporaryChatSnapshot),
    completeSession: completeSessionForStream,
    loadSubscription: refreshAfterActTextTurn,
    onError: (error, fallbackMessage) => {
      const pending = targetRuntime.nativePendingTurns?.get(textTurnId)
      if (pending) {
        pending.responses = [{
          id: `native-stream-error:${textTurnId}`, turnId: textTurnId, role: 'assistant',
          mode: 'act', model: effectiveTextModelsForTurn[0], variantIndex: 0,
          createdAt: Date.now(), contentType: 'text', status: 'error',
          parts: [{ type: 'text', text: 'The response could not be received. Retry to continue.' }],
        }]
        setRuntimeHydrationVersion(version => version + 1)
      }
      reportTextStreamError(error, fallbackMessage, onUsageExhaustedError)
    },
    logPrefix: 'Act',
  })
}
