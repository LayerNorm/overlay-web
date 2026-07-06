import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { cloneConversationUiState } from '@overlay/chat-core'
import type {
  ConversationRuntime,
  ConversationUiState,
} from '../chat-interface/types'
import { resetRuntimeState } from './conversation-runtime-utils'
import {
  PENDING_FIRST_CHAT_ID,
  TEMPORARY_CHAT_ID,
  type CompleteSession,
} from './chat-send-body-builders'

export type PendingFirstSendState = {
  conversationClientId: string
  previewRuntime: ConversationRuntime
  streamDone: boolean
  realChatId: string | null
  wasFirst: boolean
  renameSeed: string
  activeChatTitleSnapshot: string | null
}

export function isStreamChatActive({
  activeChatIdRef,
  chatId,
  isTemporaryChatRef,
  pendingFirstSendRef,
  temporaryChatSnapshot,
}: {
  activeChatIdRef: MutableRefObject<string | null>
  chatId: string
  isTemporaryChatRef: MutableRefObject<boolean>
  pendingFirstSendRef: MutableRefObject<PendingFirstSendState | null>
  temporaryChatSnapshot: boolean
}) {
  if (temporaryChatSnapshot) {
    return chatId === TEMPORARY_CHAT_ID && isTemporaryChatRef.current
  }
  if (chatId === PENDING_FIRST_CHAT_ID) {
    return pendingFirstSendRef.current != null
  }
  return activeChatIdRef.current === chatId
}

export function activatePendingFirstSend({
  activeChatIdRef,
  applyUiStateToView,
  emptyRuntime,
  markChatModified,
  pendingFirstSendRef,
  replaceConversationRuntime,
  setActiveChatId,
  setActiveViewer,
  setRuntimeHydrationVersion,
  startFirstMessageRename,
  syncStandaloneChatUrl,
}: {
  activeChatIdRef: MutableRefObject<string | null>
  applyUiStateToView: (ui: ConversationUiState) => void
  emptyRuntime: ConversationRuntime
  markChatModified: (chatId: string, titleSnapshot?: string | null) => void
  pendingFirstSendRef: MutableRefObject<PendingFirstSendState | null>
  replaceConversationRuntime: (
    chatId: string,
    uiSnapshot: ConversationUiState,
    askMessages: UIMessage[][],
    actMessages: UIMessage[],
  ) => ConversationRuntime
  setActiveChatId: (chatId: string | null) => void
  setActiveViewer: (chatId: string | null) => void
  setRuntimeHydrationVersion: Dispatch<SetStateAction<number>>
  startFirstMessageRename: (chatId: string, seedText: string) => void
  syncStandaloneChatUrl: (chatId: string | null) => void
}) {
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
  resetRuntimeState(emptyRuntime)
  pendingFirstSendRef.current = null
  setRuntimeHydrationVersion((value) => value + 1)
}

export function completeSessionForPendingFirstSend({
  completeSession,
  createDeferredChat,
  pendingFirstSendRef,
  tryActivatePendingFirstSend,
}: {
  completeSession: CompleteSession
  createDeferredChat: (conversationClientId: string) => void
  pendingFirstSendRef: MutableRefObject<PendingFirstSendState | null>
  tryActivatePendingFirstSend: () => void
}) {
  const pending = pendingFirstSendRef.current
  if (pending) {
    pending.streamDone = true
    if (!pending.realChatId) {
      createDeferredChat(pending.conversationClientId)
    }
  }
  completeSession(PENDING_FIRST_CHAT_ID, true)
  tryActivatePendingFirstSend()
}

export function showPendingFirstSendSaveFailure(
  setComposerNotice: Dispatch<SetStateAction<string | null>>,
) {
  setComposerNotice('Could not save chat. Your reply may still have streamed.')
  window.setTimeout(() => setComposerNotice(null), 4000)
}
