import { DEFAULT_CHAT_MODEL_ID } from './constants'
import type { ConversationUiState, GenerationResult } from './types'

function cloneStructured<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

export function cloneGenerationResultsMap(source: Map<number, GenerationResult[]>): Map<number, GenerationResult[]> {
  return new Map(
    Array.from(source.entries()).map(([idx, results]) => [
      idx,
      results.map((result) => ({ ...result })),
    ]),
  )
}

export function cloneOrphanModelThreadsMap<TMessage>(
  source: Map<string, TMessage[]>,
  cloneMessage: (message: TMessage) => TMessage = cloneStructured,
): Map<string, TMessage[]> {
  return new Map(
    Array.from(source.entries()).map(([modelId, thread]) => [
      modelId,
      thread.map((message) => cloneMessage(message)),
    ]),
  )
}

export function cloneConversationUiState<TMessage>(
  state: ConversationUiState<TMessage>,
  cloneMessage?: (message: TMessage) => TMessage,
): ConversationUiState<TMessage> {
  return {
    selectedActModel: state.selectedActModel,
    selectedModels: [...state.selectedModels],
    askModelSelectionMode: state.askModelSelectionMode,
    exchangeModes: [...state.exchangeModes],
    exchangeModels: state.exchangeModels.map((models) => [...models]),
    selectedTabPerExchange: [...state.selectedTabPerExchange],
    activeChatTitle: state.activeChatTitle,
    generationResults: cloneGenerationResultsMap(state.generationResults),
    exchangeGenTypes: [...state.exchangeGenTypes],
    isFirstMessage: state.isFirstMessage,
    orphanModelThreads: cloneOrphanModelThreadsMap(state.orphanModelThreads, cloneMessage),
    lastGeneratedImageUrl: state.lastGeneratedImageUrl,
  }
}

export function sameModelSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((modelId) => bSet.has(modelId))
}

export function sameModelOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((modelId, index) => modelId === b[index])
}

export function latestTextExchangeIndex(ui: ConversationUiState<unknown>): number {
  for (let i = ui.exchangeModels.length - 1; i >= 0; i--) {
    if ((ui.exchangeGenTypes[i] ?? 'text') === 'text') return i
  }
  return -1
}

export function selectedModelForExchange(ui: ConversationUiState<unknown>, exchangeIndex: number): string | null {
  if (exchangeIndex < 0) return null
  const models = ui.exchangeModels[exchangeIndex] ?? []
  if (models.length === 0) return null
  const selectedTab = Math.min(
    Math.max(ui.selectedTabPerExchange[exchangeIndex] ?? 0, 0),
    models.length - 1,
  )
  return models[selectedTab] ?? models[0] ?? null
}

export function cloneUiMessageThread<TMessage>(
  messages: TMessage[],
  cloneMessage: (message: TMessage) => TMessage = cloneStructured,
): TMessage[] {
  return messages.map((message) => cloneMessage(message))
}

export function createConversationUiState<TMessage = unknown>(
  overrides: Partial<ConversationUiState<TMessage>> = {},
  defaultModelId = DEFAULT_CHAT_MODEL_ID,
  cloneMessage?: (message: TMessage) => TMessage,
): ConversationUiState<TMessage> {
  return {
    selectedActModel: overrides.selectedActModel ?? defaultModelId,
    selectedModels: [...(overrides.selectedModels ?? [defaultModelId])],
    askModelSelectionMode: overrides.askModelSelectionMode ?? 'single',
    exchangeModes: [...(overrides.exchangeModes ?? [])],
    exchangeModels: (overrides.exchangeModels ?? []).map((models) => [...models]),
    selectedTabPerExchange: [...(overrides.selectedTabPerExchange ?? [])],
    activeChatTitle: overrides.activeChatTitle ?? null,
    generationResults: overrides.generationResults
      ? cloneGenerationResultsMap(overrides.generationResults)
      : new Map(),
    exchangeGenTypes: [...(overrides.exchangeGenTypes ?? [])],
    isFirstMessage: overrides.isFirstMessage ?? true,
    orphanModelThreads: overrides.orphanModelThreads
      ? cloneOrphanModelThreadsMap(overrides.orphanModelThreads, cloneMessage)
      : new Map(),
    lastGeneratedImageUrl: overrides.lastGeneratedImageUrl ?? null,
  }
}
