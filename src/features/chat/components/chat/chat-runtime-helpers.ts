import type { UIMessage } from '@/shared/chat/ai-ui-message'
import {
  chooseAssistantCandidate,
  createConversationUiState,
  getMessageText,
  messageHasVisibleAssistantActivity,
} from '@overlay/chat-core'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import type { ConversationRuntime, ConversationUiState } from '../chat-interface/types'

/**
 * Value-equality for two assistant messages as far as the live-sync effect cares.
 * Used to suppress no-op setMessages calls that would otherwise re-trigger the
 * helper-dependent sync effect and spin a render loop.
 */
export function sameAssistantSnapshot(a: unknown, b: unknown): boolean {
  const ma = a as { status?: string; model?: string; metadata?: { routedModelId?: string }; parts?: unknown }
  const mb = b as { status?: string; model?: string; metadata?: { routedModelId?: string }; parts?: unknown }
  if (ma.status !== mb.status) return false
  if (ma.model !== mb.model) return false
  if ((ma.metadata?.routedModelId ?? null) !== (mb.metadata?.routedModelId ?? null)) return false
  try {
    return JSON.stringify(ma.parts ?? null) === JSON.stringify(mb.parts ?? null)
  } catch {
    return false
  }
}

export function readableModelId(modelId: string): string {
  const slug = modelId.split('/').pop() ?? modelId
  const abbreviations: Record<string, string> = {
    api: 'API',
    glm: 'GLM',
    gpt: 'GPT',
    oss: 'OSS',
    vl: 'VL',
  }
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => abbreviations[part.toLowerCase()] ?? `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function assistantSnapshotKey(
  messages: Array<{ id?: string; role?: string; status?: string; parts?: unknown[] }> | undefined,
  exchangeIndex: number,
): string {
  if (!messages?.length || exchangeIndex < 0) return 'none'
  let userCount = 0
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    if (userCount === exchangeIndex) {
      const snapshots: string[] = []
      for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex++) {
        const next = messages[nextIndex]
        if (next?.role === 'user') break
        if (next?.role !== 'assistant') continue
        const partCount = Array.isArray(next.parts) ? next.parts.length : 0
        const textLen = getMessageText(next as UIMessage).length
        snapshots.push(`${next.id ?? ''}:${next.status ?? ''}:${partCount}:${textLen}`)
      }
      return snapshots.length > 0 ? snapshots.join('|') : 'none'
    }
    userCount++
  }
  return 'none'
}

function assistantsAfterUser(messages: UIMessage[], userIndex: number): UIMessage[] {
  const candidates: UIMessage[] = []
  for (let index = userIndex + 1; index < messages.length; index++) {
    const message = messages[index]
    if (message?.role === 'user') break
    if (message?.role === 'assistant') candidates.push(message)
  }
  return candidates
}

function findAssistantAtExchange(messages: UIMessage[] | undefined, exchangeIndex: number): UIMessage | null {
  if (!messages?.length || exchangeIndex < 0) return null
  let userCount = 0
  for (let index = 0; index < messages.length; index++) {
    if (messages[index]?.role !== 'user') continue
    if (userCount === exchangeIndex) {
      return chooseAssistantCandidate(assistantsAfterUser(messages, index))
    }
    userCount++
  }
  return null
}

export function getResponseForExchange({
  exchangeIndex,
  activeRuntime,
}: {
  exchangeIndex: number
  activeRuntime: ConversationRuntime
}): UIMessage | null {
  const preferredLists = [
    activeRuntime.actChat.messages as UIMessage[],
    activeRuntime.askChats[0]?.messages ?? [],
  ]

  let fallback: UIMessage | null = null
  for (const messages of preferredLists) {
    const candidate = findAssistantAtExchange(messages, exchangeIndex)
    if (!candidate) continue
    if (messageHasVisibleAssistantActivity(candidate) || !fallback) {
      if (messageHasVisibleAssistantActivity(candidate)) return candidate
      fallback = candidate
    }
  }
  return fallback
}

export function removeTurnFromConversationRuntime(
  runtime: ConversationRuntime,
  turnId: string,
): { removedExchangeIndex: number } {
  const removeTurn = (messages: UIMessage[]) => messages.filter((message) => (
    ((message as { turnId?: string }).turnId || message.id) !== turnId
  ))

  const previousUserTurnIds = (runtime.askChats[0]?.messages ?? [])
    .filter((message) => message.role === 'user')
    .map((message) => ((message as { turnId?: string }).turnId || message.id))
  const removedExchangeIndex = previousUserTurnIds.indexOf(turnId)

  runtime.askChats[0].messages = removeTurn(runtime.askChats[0].messages as UIMessage[]) as never
  runtime.actChat.messages = removeTurn(runtime.actChat.messages as UIMessage[]) as never

  if (removedExchangeIndex >= 0) {
    runtime.ui = createConversationUiState({
      ...runtime.ui,
      exchangeModes: runtime.ui.exchangeModes.filter((_, index) => index !== removedExchangeIndex),
      exchangeModels: runtime.ui.exchangeModels.filter((_, index) => index !== removedExchangeIndex),
      exchangeGenTypes: runtime.ui.exchangeGenTypes.filter((_, index) => index !== removedExchangeIndex),
      generationResults: new Map(
        [...runtime.ui.generationResults.entries()]
          .filter(([index]) => index !== removedExchangeIndex)
          .map(([index, value]) => [index > removedExchangeIndex ? index - 1 : index, value]),
      ),
      isFirstMessage: !runtime.askChats[0]?.messages.some((message) => message.role === 'user'),
    })
  }

  return { removedExchangeIndex }
}

/**
 * The picker writes the model choice to view state only, so a runtime snapshot
 * can lag behind it. Carry the visible choice into the snapshot before applying
 * it back to the view, or the composer reverts to the chat's earlier model.
 */
export function withViewModelSelection(
  ui: ConversationUiState,
  view: { selectedModels: string[]; selectedActModel: string },
): ConversationUiState {
  const normalized = normalizeChatModelSelection({
    askModelIds: view.selectedModels,
    actModelId: view.selectedActModel,
  })
  return {
    ...ui,
    selectedModels: [...normalized.askModelIds],
    selectedActModel: normalized.actModelId,
  }
}
