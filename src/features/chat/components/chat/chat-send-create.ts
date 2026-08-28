import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import posthog from 'posthog-js'
import { createIdempotencyKey } from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import { dispatchChatCreated } from '@/shared/chat/chat-title'
import { upsertCachedChat } from '@/shared/chat/chat-list-cache'
import { DEFAULT_CHAT_TITLE } from '../chat-interface/constants'
import type {
  AskModelSelectionMode,
  Conversation,
  ConversationRuntime,
  ConversationUiState,
} from '../chat-interface/types'
import { resetRuntimeState } from './conversation-runtime-utils'
import type { EnsureConversationRuntime } from './chat-send-body-builders'
import { startPendingFirstSendRename, type PendingFirstSendState } from './chat-send-pending-first'

export type CreateNewChatOptions = {
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

export async function createNewChatForSend({
  activeChatIdRef,
  applyUiStateToView,
  askModelSelectionMode,
  clearTransientComposerState,
  embedProjectId,
  emptyRuntime,
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
  startFirstMessageRename,
  tryActivatePendingFirstSend,
}: {
  activeChatIdRef: MutableRefObject<string | null>
  applyUiStateToView: (ui: ConversationUiState) => void
  askModelSelectionMode: AskModelSelectionMode
  clearTransientComposerState: () => void
  embedProjectId: string | null
  emptyRuntime: ConversationRuntime
  ensureConversationRuntime: EnsureConversationRuntime
  invalidateLoadChatRequest: () => void
  mode: 'chat' | 'automate'
  options: CreateNewChatOptions
  pendingFirstSendRef: MutableRefObject<PendingFirstSendState | null>
  pendingScrollChatIdRef: MutableRefObject<string | null>
  pendingScrollTurnIdRef: MutableRefObject<string | null>
  persistActiveRuntimeUiState: () => void
  resetComposerToolIds: (temporary: boolean) => void
  selectedActModel: string
  selectedModels: string[]
  setActiveChatId: (chatId: string | null) => void
  setActiveViewer: (chatId: string | null) => void
  setChats: Dispatch<SetStateAction<Conversation[]>>
  setInterruptedExchangeIdx: (idx: number | null) => void
  setIsTemporaryChat: (isTemporaryChat: boolean) => void
  setRuntimeHydrationVersion: Dispatch<SetStateAction<number>>
  syncStandaloneChatUrl: (chatId: string | null) => void
  startFirstMessageRename: (chatId: string, seedText: string) => void
  tryActivatePendingFirstSend: () => void
}): Promise<string | null> {
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
      startPendingFirstSendRename(pending, startFirstMessageRename)
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
  resetRuntimeState(emptyRuntime)
  clearTransientComposerState()
  return data.id
}
