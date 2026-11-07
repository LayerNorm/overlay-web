import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { createIdempotencyKey } from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { isPlaceholderChatTitle } from '@/shared/chat/chat-title'
import { DEFAULT_CHAT_TITLE } from '../chat-interface/constants'
import { legacyWorkspaceScopeForRoute, readWorkspacePathScope } from '@/shared/workspaces/routing'
import { peekResolvedTitle } from '@/features/chat/lib/generate-title'
import { markConversationScopeVerified } from '../conversationScopeVerification'
import type {
  ConversationRuntime,
  ConversationUiState,
} from '../chat-interface/types'
import { resetRuntimeState } from './conversation-runtime-utils'
import type { EnsureConversationRuntime } from './chat-send-body-builders'
import { startPendingFirstSendRename, type PendingFirstSendState } from './chat-send-pending-first'
import {
  chatReasoningStorageKey,
  writeStoredReasoningByModel,
  type ReasoningByModel,
} from '@/shared/chat/chat-model-prefs'

export type CreateNewChatOptions = {
  title?: string
  clientId?: string
  deferActivation?: boolean
  persistedChatId?: string
  prepareRuntime?: (args: {
    chatId: string
    runtime: ConversationRuntime
    selectedModels: string[]
    selectedActModel: string
  }) => void
  reasoningByModelSnapshot?: ReasoningByModel
}

function newChatTitle(
  mode: 'chat' | 'automate',
  options: CreateNewChatOptions,
  pendingFirstSend: PendingFirstSendState | null,
) {
  const pendingTitleSeed = options.clientId
    ? pendingFirstSend?.conversationClientId === options.clientId
      ? pendingFirstSend.renameSeed
      : undefined
    : undefined
  const prefetchedTitle = mode === 'chat' && pendingTitleSeed
    ? peekResolvedTitle(pendingTitleSeed)
    : null
  return isPlaceholderChatTitle(options.title)
    ? prefetchedTitle ?? (mode === 'automate' ? options.title?.trim() || 'New automation' : DEFAULT_CHAT_TITLE)
    : options.title!
}

/** Rooms hand off retired threads to a new chat. Removed with the room migration, CN-08. */
export async function createHandoffConversation({
  workspaceId,
  title,
}: {
  workspaceId: string | null
  title: string
}): Promise<string | null> {
  const scope = workspaceId ? 'workspace' : 'personal'
  const response = await overlayAppClient.conversations.createResponse(
    {
      title,
      askModelIds: [DEFAULT_MODEL_ID],
      actModelId: DEFAULT_MODEL_ID,
      lastMode: 'act',
      ...(workspaceId ? { scope: 'workspace' as const } : {}),
    },
    { idempotencyKey: createIdempotencyKey() },
  )
  if (!response.ok) return null
  const data = await response.json() as { id: string }
  markConversationScopeVerified(scope, data.id)
  return data.id
}

export async function createNewChatForSend({
  activeChatIdRef,
  applyUiStateToView,
  clearTransientComposerState,
  emptyRuntime,
  ensureConversationRuntime,
  invalidateLoadChatRequest,
  isCurrentScope,
  mode,
  createNativePersonalChat,
  nativePersonalEnabled = false,
  nativePersonalRoute = false,
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
}: {
  activeChatIdRef: MutableRefObject<string | null>
  applyUiStateToView: (ui: ConversationUiState) => void
  clearTransientComposerState: () => void
  emptyRuntime: ConversationRuntime
  ensureConversationRuntime: EnsureConversationRuntime
  invalidateLoadChatRequest: () => void
  isCurrentScope?: () => boolean
  mode: 'chat' | 'automate'
  createNativePersonalChat?: (args: {
    workspaceId: string
    clientId: string
    title: string
    askModelIds: string[]
    actModelId: string
    lastMode: 'act'
    scope: 'personal' | 'workspace'
  }) => Promise<string>
  nativePersonalEnabled?: boolean
  nativePersonalRoute?: boolean
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
  setInterruptedExchangeIdx: (idx: number | null) => void
  setIsTemporaryChat: (isTemporaryChat: boolean) => void
  setPendingRunConversationId: (conversationId: string | null) => void
  setRuntimeHydrationVersion: Dispatch<SetStateAction<number>>
  syncStandaloneChatUrl: (chatId: string | null) => void
  startFirstMessageRename: (chatId: string, seedText: string, nativePersonalOwner?: boolean) => void
  tryActivatePendingFirstSend: () => void
  workspaceId?: string | null
}): Promise<string | null> {
  const initialTitle = newChatTitle(mode, options, pendingFirstSendRef.current)
  const normalizedInitialSelection = normalizeChatModelSelection({
    askModelIds: selectedModels.slice(0, 1),
    actModelId: selectedActModel,
  })
  const initialSelectedModels = normalizedInitialSelection.askModelIds
  const workspaceScoped = workspaceChatsViewActive()
  const nativePersonalCreated = nativePersonalEnabled && nativePersonalRoute
  const trimmedClientId = options.clientId?.trim()
    || (nativePersonalCreated ? crypto.randomUUID() : undefined)
  const prepareActivation = () => {
    invalidateLoadChatRequest()
    persistActiveRuntimeUiState()
    setIsTemporaryChat(false)
    resetComposerToolIds(false)
  }
  if (!nativePersonalCreated) prepareActivation()
  async function persistConversation() {
    let data: { id: string }
    if (nativePersonalCreated) {
      if (!isCurrentScope) throw new Error('Native personal chat scope is unavailable')
      if (!isCurrentScope()) return null
      if (options.persistedChatId) {
        data = { id: options.persistedChatId }
      } else {
        if (!workspaceId || !trimmedClientId || !createNativePersonalChat) {
          throw new Error('Native personal chat is unavailable')
        }
        data = {
          id: await createNativePersonalChat({
            workspaceId,
            clientId: trimmedClientId,
            title: initialTitle,
            askModelIds: initialSelectedModels,
            actModelId: normalizedInitialSelection.actModelId,
            lastMode: 'act',
            scope: workspaceScoped ? 'workspace' : 'personal',
          }),
        }
      }
      if (!isCurrentScope()) return null
    } else {
      throw new Error('Native personal chat is unavailable')
    }
    return data
  }
  const data = await persistConversation()
  if (!data) return null
  if (nativePersonalCreated) prepareActivation()
  markConversationScopeVerified(workspaceScoped ? 'workspace' : 'personal', data.id)
  if (options.reasoningByModelSnapshot) {
    writeStoredReasoningByModel(
      chatReasoningStorageKey({ type: 'thread', id: data.id }),
      options.reasoningByModelSnapshot,
    )
  }
  setInterruptedExchangeIdx(null)
  const pendingFirstSend = pendingFirstSendRef.current
  if (pendingFirstSend) pendingFirstSend.nativePersonalOwner = nativePersonalCreated
  if (options.deferActivation) {
    const pending = pendingFirstSendRef.current
    if (pending && trimmedClientId && pending.conversationClientId === trimmedClientId) {
      pending.realChatId = data.id
      setPendingRunConversationId(data.id)
      startPendingFirstSendRename(pending, startFirstMessageRename)
      if (pendingScrollTurnIdRef.current && !pendingScrollChatIdRef.current) {
        pendingScrollChatIdRef.current = data.id
      }
      // The native chat is durable now, so a reload during the first turn can reopen it.
      if (nativePersonalCreated) syncStandaloneChatUrl(data.id)
      tryActivatePendingFirstSend()
    }
    return data.id
  }

  const runtime = ensureConversationRuntime(data.id, {
    selectedActModel: normalizedInitialSelection.actModelId,
    selectedModels: initialSelectedModels,
    activeChatTitle: initialTitle,
    isFirstMessage: true,
  })
  resetRuntimeState(runtime, {
    selectedActModel: normalizedInitialSelection.actModelId,
    selectedModels: initialSelectedModels,
    activeChatTitle: initialTitle,
    isFirstMessage: true,
  })
  options.prepareRuntime?.({
    chatId: data.id,
    runtime,
    selectedModels: initialSelectedModels,
    selectedActModel: normalizedInitialSelection.actModelId,
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

/** A chat started from the Workspace "Chats" list belongs to the Workspace scope. */
export function workspaceChatsViewActive(): boolean {
  if (typeof window === 'undefined') return false
  const pathScope = readWorkspacePathScope(window.location.pathname)
  if (pathScope) return pathScope === 'workspace'
  return legacyWorkspaceScopeForRoute(
    'chat',
    new URLSearchParams(window.location.search),
  ) === 'workspace'
}
