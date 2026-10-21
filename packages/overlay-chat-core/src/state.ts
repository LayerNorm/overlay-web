import { DEFAULT_CHAT_MODEL_ID } from './constants'
import type { ConversationUiState, GenerationResult } from './types'

function cloneStructured<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    // Last-resort fallback for values structuredClone rejects (functions,
    // symbols): the JSON round-trip strips them rather than throwing.
    // react-doctor-disable-next-line react-doctor/no-json-parse-stringify-clone
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

export function cloneConversationUiState<TMessage>(
  state: ConversationUiState<TMessage>,
  cloneMessage?: (message: TMessage) => TMessage,
): ConversationUiState<TMessage> {
  return {
    selectedActModel: state.selectedActModel,
    selectedModels: state.selectedModels.slice(0, 1),
    exchangeModes: [...state.exchangeModes],
    exchangeModels: state.exchangeModels.map((models) => models.slice(0, 1)),
    activeChatTitle: state.activeChatTitle,
    generationResults: cloneGenerationResultsMap(state.generationResults),
    exchangeGenTypes: [...state.exchangeGenTypes],
    isFirstMessage: state.isFirstMessage,
    lastGeneratedImageUrl: state.lastGeneratedImageUrl,
  }
}

export function latestTextExchangeIndex(ui: ConversationUiState<unknown>): number {
  for (let i = ui.exchangeModels.length - 1; i >= 0; i--) {
    if ((ui.exchangeGenTypes[i] ?? 'text') === 'text') return i
  }
  return -1
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
    selectedModels: (overrides.selectedModels ?? [defaultModelId]).slice(0, 1),
    exchangeModes: [...(overrides.exchangeModes ?? [])],
    exchangeModels: (overrides.exchangeModels ?? []).map((models) => models.slice(0, 1)),
    activeChatTitle: overrides.activeChatTitle ?? null,
    generationResults: overrides.generationResults
      ? cloneGenerationResultsMap(overrides.generationResults)
      : new Map(),
    exchangeGenTypes: [...(overrides.exchangeGenTypes ?? [])],
    isFirstMessage: overrides.isFirstMessage ?? true,
    lastGeneratedImageUrl: overrides.lastGeneratedImageUrl ?? null,
  }
}
