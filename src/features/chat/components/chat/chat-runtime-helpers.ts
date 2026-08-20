import type { UIMessage } from '@/shared/chat/ai-ui-message'
import {
  chooseAssistantCandidate,
  cloneOrphanModelThreadsMap,
  cloneUiMessageThread,
  createConversationUiState,
  getMessageText,
  latestTextExchangeIndex,
  messageHasVisibleAssistantActivity,
  sameModelOrder,
  sameModelSet,
  selectedModelForExchange,
} from '@overlay/chat-core'
import type { ConversationRuntime } from '../chat-interface/types'

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

function messageModelId(message: UIMessage | null): string | undefined {
  return (message as { model?: string } | null)?.model
}

export function getResponseForExchangeForModel({
  modelId,
  exchangeIndex,
  slotOrder,
  selectedModels,
  activeRuntime,
  activeAskChats,
  isActiveLoading,
}: {
  modelId: string
  exchangeIndex: number
  /** For Act multi-compare, slot order is the exchange's model list, not the global picker. */
  slotOrder?: string[]
  selectedModels: string[]
  activeRuntime: ConversationRuntime
  activeAskChats: Array<{ messages: UIMessage[] }>
  isActiveLoading: boolean
}): UIMessage | null {
  const order = slotOrder && slotOrder.length > 0 ? slotOrder : selectedModels
  const liveIdx = order.indexOf(modelId)
  const canUseLiveSlot =
    liveIdx >= 0 &&
    (sameModelOrder(order, activeRuntime.ui.selectedModels) ||
      (isActiveLoading && !!slotOrder?.length))
  const preferredLists: UIMessage[][] = []
  if (canUseLiveSlot) preferredLists.push(activeAskChats[liveIdx]?.messages ?? [])
  const orphanThread = activeRuntime.ui.orphanModelThreads.get(modelId)
  if (orphanThread?.length) preferredLists.push(orphanThread as UIMessage[])
  preferredLists.push(activeRuntime.actChat.messages as UIMessage[])
  for (const chat of activeAskChats) {
    if (chat.messages?.length) preferredLists.push(chat.messages)
  }

  let fallback: UIMessage | null = null
  for (const messages of preferredLists) {
    const candidate = findAssistantAtExchange(messages, exchangeIndex)
    if (!candidate) continue
    const candidateModel = messageModelId(candidate)
    if (candidateModel && candidateModel !== modelId) {
      if (!fallback && messageHasVisibleAssistantActivity(candidate)) fallback = candidate
      continue
    }
    if (messageHasVisibleAssistantActivity(candidate) || !fallback) {
      if (messageHasVisibleAssistantActivity(candidate)) return candidate
      fallback = candidate
    }
  }
  return fallback
}

export function prepareAskModelThreadsForTextTurn(
  runtime: ConversationRuntime,
  nextModelIds: string[],
): { historyBaseModelId?: string } {
  const ui = runtime.ui
  const nextModels = nextModelIds.slice(0, 4)
  if (nextModels.length === 0) return {}

  const orphanThreads = cloneOrphanModelThreadsMap(ui.orphanModelThreads)
  ui.selectedModels.slice(0, 4).forEach((modelId, slotIdx) => {
    const slotMessages = runtime.askChats[slotIdx]?.messages
    if (slotMessages?.length) {
      orphanThreads.set(modelId, cloneUiMessageThread(slotMessages as UIMessage[]))
    }
  })

  const latestTextIdx = latestTextExchangeIndex(ui)
  const previousModels = latestTextIdx >= 0 ? (ui.exchangeModels[latestTextIdx] ?? []) : []
  const modelSetUnchanged = previousModels.length > 0 && sameModelSet(previousModels, nextModels)
  const selectedBaseModelId = selectedModelForExchange(ui, latestTextIdx)
  const baseModelId = modelSetUnchanged ? undefined : selectedBaseModelId ?? previousModels[0] ?? ui.selectedModels[0]
  const baseSlotIdx = baseModelId ? ui.selectedModels.indexOf(baseModelId) : -1
  const activeBaseThread =
    baseSlotIdx >= 0 ? (runtime.askChats[baseSlotIdx]?.messages as UIMessage[] | undefined) : undefined
  const baseThread =
    baseModelId
      ? orphanThreads.get(baseModelId) ?? activeBaseThread
      : undefined

  nextModels.forEach((modelId, slotIdx) => {
    const sourceThread =
      modelSetUnchanged
        ? orphanThreads.get(modelId) ?? []
        : baseThread ?? orphanThreads.get(modelId) ?? []
    runtime.askChats[slotIdx]!.messages = cloneUiMessageThread(sourceThread as UIMessage[])
  })
  for (let slotIdx = nextModels.length; slotIdx < runtime.askChats.length; slotIdx++) {
    runtime.askChats[slotIdx]!.messages = []
  }
  runtime.ui = createConversationUiState({
    ...ui,
    selectedModels: nextModels,
    selectedActModel: nextModels[0] ?? ui.selectedActModel,
    askModelSelectionMode: nextModels.length > 1 ? 'multiple' : 'single',
    orphanModelThreads: orphanThreads,
  })
  return baseModelId ? { historyBaseModelId: baseModelId } : {}
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

  runtime.askChats.forEach((chat) => {
    chat.messages = removeTurn(chat.messages as UIMessage[]) as never
  })
  runtime.actChat.messages = removeTurn(runtime.actChat.messages as UIMessage[]) as never

  if (removedExchangeIndex >= 0) {
    runtime.ui = createConversationUiState({
      ...runtime.ui,
      exchangeModes: runtime.ui.exchangeModes.filter((_, index) => index !== removedExchangeIndex),
      exchangeModels: runtime.ui.exchangeModels.filter((_, index) => index !== removedExchangeIndex),
      selectedTabPerExchange: runtime.ui.selectedTabPerExchange.filter((_, index) => index !== removedExchangeIndex),
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
