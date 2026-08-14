import type { UIMessage } from '@/shared/chat/ai-ui-message'
import {
  deriveChatExchangeStatus,
  getMessageImageAttachments,
  getMessageText,
  getRoutedModelId,
  getUserMessageDocNames,
  getUserReplyThreadMeta,
  getUserTurnId,
  normalizeTranscriptAssistantParts,
  selectTranscriptResponse,
  splitUserDisplayText,
  transcriptResponseId,
} from '@overlay/chat-core'
import type {
  ChatExchangeStatus,
  ChatMode,
  ChatTranscriptExchangeView,
  ChatTranscriptResponseView,
  ChatTranscriptView,
  GenerationMode,
  GenerationResult,
  SourceCitationMap,
} from '@overlay/chat-core'

type PersistedResponseStatus = 'generating' | 'completed' | 'error'
type WebRuntimeStatus = 'ready' | 'submitted' | 'streaming' | 'error'

export interface WebTranscriptResponseRuntime {
  status?: WebRuntimeStatus
  error?: unknown
}

export interface WebChatTranscriptAdapterInput {
  primaryMessages: readonly UIMessage[]
  exchangeModes: readonly ChatMode[]
  exchangeModels: readonly (readonly string[])[]
  selectedTabPerExchange: readonly number[]
  selectedModels: readonly string[]
  exchangeGenTypes?: readonly GenerationMode[]
  generationResults?: ReadonlyMap<number, readonly GenerationResult[]>
  latestExchangeIndex: number
  isActiveLoading?: boolean
  isOptimisticLoading?: boolean
  interruptedExchangeIdx?: number | null
  getResponseForExchangeForModel: (
    modelId: string,
    exchangeIndex: number,
    slotOrder?: string[],
  ) => UIMessage | null
  getResponseRuntime?: (
    modelId: string,
    exchangeIndex: number,
  ) => WebTranscriptResponseRuntime | null
}

type ExchangeCacheEntry = {
  signature: string
  responseSources: readonly (UIMessage | null)[]
  generationResults: readonly GenerationResult[] | undefined
  exchange: ChatTranscriptExchangeView
}

function sameIdentityList(
  left: readonly (UIMessage | null)[],
  right: readonly (UIMessage | null)[],
): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function errorMessage(error: unknown): string | null {
  if (!error) return null
  if (error instanceof Error) return error.message || 'Generation failed'
  return typeof error === 'string' ? error : 'Generation failed'
}

function runtimeStatusForCore(status: WebRuntimeStatus | undefined) {
  if (status === 'ready' || !status) return undefined
  return status
}

function statusFromMedia(results: readonly GenerationResult[]): ChatExchangeStatus {
  if (results.some((result) => result.status === 'failed')) return 'error'
  if (results.some((result) => result.status === 'generating')) return 'streaming'
  if (results.length > 0 && results.every((result) => result.status === 'completed')) return 'completed'
  return 'idle'
}

export function createWebChatTranscriptAdapter() {
  const exchangeCache = new WeakMap<object, ExchangeCacheEntry>()

  return function toChatTranscriptView(input: WebChatTranscriptAdapterInput): ChatTranscriptView {
    const userMessages = input.primaryMessages.filter((message) => message.role === 'user')
    const exchanges = userMessages.map((message, exchangeIndex) => {
      const turnId = getUserTurnId(message) ?? message.id
      const mode = input.exchangeModes[exchangeIndex] ?? 'ask'
      const generationMode = input.exchangeGenTypes?.[exchangeIndex] ?? 'text'
      const modelIds = input.exchangeModels[exchangeIndex]?.length
        ? [...input.exchangeModels[exchangeIndex]!]
        : input.selectedModels[0]
          ? [input.selectedModels[0]]
          : []
      const selectedTab = input.selectedTabPerExchange[exchangeIndex] ?? 0
      const selectedModelId = modelIds[selectedTab] ?? modelIds[0] ?? null
      const responseSources = modelIds.map((modelId) =>
        input.getResponseForExchangeForModel(
          modelId,
          exchangeIndex,
          mode === 'act' && modelIds.length > 1 ? modelIds : undefined,
        ),
      )
      const mediaResults = input.generationResults?.get(exchangeIndex)
      const isLatest = exchangeIndex === input.latestExchangeIndex
      const interrupted = input.interruptedExchangeIdx === exchangeIndex
      const fallbackRuntimeStatus: WebRuntimeStatus | undefined = isLatest
        ? input.isOptimisticLoading
          ? 'submitted'
          : input.isActiveLoading
            ? 'streaming'
            : undefined
        : undefined

      const responseStatuses = modelIds.map((modelId, index) => {
        const response = responseSources[index]
        const persistedStatus = (response as { status?: PersistedResponseStatus } | null)?.status
        const runtime = input.getResponseRuntime?.(modelId, exchangeIndex)
        const isResponseDone = persistedStatus === 'completed' || (!runtime?.status && Boolean(response && getMessageText(response).trim()))
        const effectiveRuntimeStatus = isResponseDone ? runtimeStatusForCore(runtime?.status) : runtimeStatusForCore(runtime?.status ?? fallbackRuntimeStatus)
        return deriveChatExchangeStatus({
          runtimeStatus: effectiveRuntimeStatus,
          persistedStatus,
          hasResponse: Boolean(response),
          hasVisibleContent: Boolean(response && getMessageText(response).trim()),
          interrupted,
          error: runtime?.error,
        })
      })
      const selectedStatus = responseStatuses[selectedTab] ?? responseStatuses[0]
      const exchangeStatus = generationMode === 'text'
        ? selectedStatus ?? deriveChatExchangeStatus({
            runtimeStatus: runtimeStatusForCore(fallbackRuntimeStatus),
            interrupted,
          })
        : statusFromMedia(mediaResults ?? [])
      const signature = JSON.stringify({
        exchangeIndex,
        mode,
        generationMode,
        modelIds,
        selectedTab,
        selectedModelId,
        responseStatuses,
        exchangeStatus,
      })
      const sourceKey = message as object
      const cached = exchangeCache.get(sourceKey)
      const isActivelyChanging = exchangeStatus === 'submitted' || exchangeStatus === 'streaming' || exchangeStatus === 'executing-tool'
      if (
        !isActivelyChanging &&
        cached?.signature === signature &&
        cached.generationResults === mediaResults &&
        sameIdentityList(cached.responseSources, responseSources)
      ) {
        return cached.exchange
      }

      const rawText = getMessageText(message)
      const createdAt = (message as unknown as { createdAt?: unknown }).createdAt
      const metadataDocs = getUserMessageDocNames(message)
      const parsed = splitUserDisplayText(rawText)
      const metadata = (message as {
        metadata?: {
          indexedAttachments?: Array<{ name: string; fileIds: string[] }>
          mentions?: Array<{ type: string; id: string; name: string; fileIds?: string[] }>
        }
      }).metadata
      const responses: ChatTranscriptResponseView[] = modelIds.flatMap((modelId, responseIndex) => {
        const response = responseSources[responseIndex]
        if (!response) return []
        const normalized = normalizeTranscriptAssistantParts(
          Array.isArray((response as { parts?: unknown[] }).parts)
            ? (response as { parts: unknown[] }).parts
            : undefined,
        )
        const runtime = input.getResponseRuntime?.(modelId, exchangeIndex)
        const persistedStatus = (response as { status?: PersistedResponseStatus }).status
        const responseError = runtime?.error ?? (persistedStatus === 'error' ? 'Generation failed' : null)
        const sourceCitations = (response as { metadata?: { sourceCitations?: SourceCitationMap } }).metadata?.sourceCitations
        const routedModelId = getRoutedModelId(response)
        return [{
          id: transcriptResponseId(turnId, modelId, responseIndex),
          modelId,
          blocks: normalized.blocks,
          sources: normalized.sources,
          ...(sourceCitations ? { sourceCitations } : {}),
          ...(routedModelId ? { routedModelId } : {}),
          status: responseStatuses[responseIndex] ?? 'completed',
          errorMessage: errorMessage(responseError),
        }]
      })
      const selected = selectTranscriptResponse(responses, { selectedModelId, selectedIndex: selectedTab })
      const exchange: ChatTranscriptExchangeView = {
        id: turnId,
        turnId,
        index: exchangeIndex,
        mode,
        generationMode,
        user: {
          id: message.id,
          text: metadataDocs.length > 0 ? rawText.trim() : parsed.bodyText,
          documentNames: metadataDocs.length > 0 ? metadataDocs : parsed.docNames,
          indexedAttachments: metadata?.indexedAttachments ?? [],
          images: getMessageImageAttachments(message),
          mentions: metadata?.mentions ?? [],
          replyThread: getUserReplyThreadMeta(message),
          createdAt: typeof createdAt === 'number' ? createdAt : undefined,
        },
        responses,
        selectedResponseIndex: selected.index,
        selectedModelId: selected.response?.modelId ?? selectedModelId,
        status: exchangeStatus,
        media: generationMode === 'image' || generationMode === 'video'
          ? { kind: generationMode, results: mediaResults ? [...mediaResults] : [] }
          : null,
      }

      exchangeCache.set(sourceKey, { signature, responseSources, generationResults: mediaResults, exchange })
      return exchange
    })

    return { version: 1, exchanges }
  }
}

const defaultWebChatTranscriptAdapter = createWebChatTranscriptAdapter()

export const toChatTranscriptView = defaultWebChatTranscriptAdapter
