import { buildAssistantVisualSequence } from './visual-sequence'
import type {
  ActiveRunState,
  AssistantVisualBlock,
  ChatMode,
  GenerationMode,
  GenerationResult,
  RestoredOutputGroup,
  SourceCitationMap,
} from './types'

/**
 * Renderer-neutral transcript data. Web and desktop can build this contract
 * without committing either surface to a shared renderer yet.
 */
export interface ChatTranscriptView {
  version: 1
  exchanges: readonly ChatTranscriptExchangeView[]
}

export type ChatExchangeStatus =
  | 'idle'
  | 'submitted'
  | 'streaming'
  | 'awaiting-approval'
  | 'executing-tool'
  | 'completed'
  | 'interrupted'
  | 'error'
  | 'cancelled'

export interface ChatTranscriptImageView {
  url: string
  name: string
  mediaType?: string
  status?: 'loading' | 'loaded' | 'retrying' | 'failed'
}

export interface ChatTranscriptMentionView {
  type: string
  id: string
  name: string
  fileIds?: readonly string[]
}

export interface ChatTranscriptUserView {
  id: string
  text: string
  documentNames: readonly string[]
  indexedAttachments: readonly { name: string; fileIds: readonly string[] }[]
  images: readonly ChatTranscriptImageView[]
  mentions: readonly ChatTranscriptMentionView[]
  replyThread: { replyToTurnId: string; replySnippet: string } | null
  createdAt?: number
}

export interface ChatTranscriptSourceView {
  id: string
  sourceKind: 'url' | 'document'
  sourceId: string
  url?: string
  title?: string
  mediaType?: string
  filename?: string
  originIndex: number
}

export interface ChatTranscriptResponseView {
  id: string
  modelId: string
  blocks: readonly AssistantVisualBlock[]
  sources: readonly ChatTranscriptSourceView[]
  sourceCitations?: SourceCitationMap
  routedModelId?: string
  status: ChatExchangeStatus
  errorMessage: string | null
}

export interface ChatTranscriptMediaView {
  kind: 'image' | 'video'
  results: readonly GenerationResult[]
}

export interface ChatTranscriptExchangeView {
  id: string
  turnId: string
  index: number
  mode: ChatMode
  generationMode: GenerationMode
  user: ChatTranscriptUserView
  responses: readonly ChatTranscriptResponseView[]
  selectedResponseIndex: number
  selectedModelId: string | null
  status: ChatExchangeStatus
  media: ChatTranscriptMediaView | null
}

export type TranscriptMessageLike = {
  id: string
  role: 'user' | 'assistant'
  turnId?: string | null
}

export interface TranscriptMessageGroup<TMessage extends TranscriptMessageLike> {
  turnId: string
  user: TMessage | null
  assistants: TMessage[]
}

/**
 * Groups explicit turn IDs when present and safely falls back to alternating
 * user/assistant history for legacy messages without turn IDs.
 */
export function groupTranscriptMessages<TMessage extends TranscriptMessageLike>(
  messages: readonly TMessage[],
): TranscriptMessageGroup<TMessage>[] {
  const groups: TranscriptMessageGroup<TMessage>[] = []
  const byTurnId = new Map<string, TranscriptMessageGroup<TMessage>>()
  let currentLegacyGroup: TranscriptMessageGroup<TMessage> | null = null

  const createGroup = (turnId: string): TranscriptMessageGroup<TMessage> => {
    const group = { turnId, user: null, assistants: [] }
    groups.push(group)
    byTurnId.set(turnId, group)
    return group
  }

  for (const [index, message] of messages.entries()) {
    const explicitTurnId = message.turnId?.trim() || null
    if (explicitTurnId) {
      const group = byTurnId.get(explicitTurnId) ?? createGroup(explicitTurnId)
      if (message.role === 'user') {
        group.user = message
        currentLegacyGroup = group
      } else {
        group.assistants.push(message)
      }
      continue
    }

    if (message.role === 'user') {
      const syntheticTurnId = message.id.trim() || `legacy-turn-${index}`
      currentLegacyGroup = byTurnId.get(syntheticTurnId) ?? createGroup(syntheticTurnId)
      currentLegacyGroup.user = message
      continue
    }

    if (currentLegacyGroup) {
      currentLegacyGroup.assistants.push(message)
      continue
    }

    const orphanTurnId = `legacy-orphan-${message.id.trim() || index}`
    createGroup(orphanTurnId).assistants.push(message)
  }

  return groups
}

export function selectTranscriptResponse<TResponse extends { modelId: string }>(
  responses: readonly TResponse[],
  options: { selectedModelId?: string | null; selectedIndex?: number | null } = {},
): { response: TResponse | null; index: number } {
  if (responses.length === 0) return { response: null, index: -1 }

  if (options.selectedModelId) {
    const modelIndex = responses.findIndex((response) => response.modelId === options.selectedModelId)
    if (modelIndex >= 0) return { response: responses[modelIndex]!, index: modelIndex }
  }

  if (
    typeof options.selectedIndex === 'number' &&
    options.selectedIndex >= 0 &&
    options.selectedIndex < responses.length
  ) {
    return { response: responses[options.selectedIndex]!, index: options.selectedIndex }
  }

  return { response: responses[0]!, index: 0 }
}

type RuntimeStatus = ActiveRunState['status'] | 'submitted' | 'error' | null | undefined
type PersistedStatus = 'generating' | 'completed' | 'error' | 'failed' | null | undefined

export function deriveChatExchangeStatus(input: {
  runtimeStatus?: RuntimeStatus
  persistedStatus?: PersistedStatus
  hasResponse?: boolean
  hasVisibleContent?: boolean
  interrupted?: boolean
  error?: unknown
}): ChatExchangeStatus {
  if (input.error || input.persistedStatus === 'error' || input.persistedStatus === 'failed' || input.runtimeStatus === 'error' || input.runtimeStatus === 'failed') {
    return 'error'
  }
  if (input.interrupted) return 'interrupted'
  if (input.runtimeStatus === 'cancelled') return 'cancelled'
  if (input.runtimeStatus === 'awaiting_approval') return 'awaiting-approval'
  if (input.runtimeStatus === 'executing_tool') return 'executing-tool'
  if (input.runtimeStatus === 'streaming' || input.persistedStatus === 'generating') return 'streaming'
  if (input.runtimeStatus === 'submitted') return 'submitted'
  if (input.runtimeStatus === 'completed' || input.persistedStatus === 'completed' || input.hasResponse || input.hasVisibleContent) return 'completed'
  return 'idle'
}

export function normalizeTranscriptAssistantParts(parts: readonly unknown[] | undefined): {
  blocks: AssistantVisualBlock[]
  sources: ChatTranscriptSourceView[]
} {
  const blocks: AssistantVisualBlock[] = []
  const sources: ChatTranscriptSourceView[] = []
  let visualChunk: unknown[] = []

  const flushVisualChunk = () => {
    if (visualChunk.length === 0) return
    blocks.push(...buildAssistantVisualSequence(visualChunk))
    visualChunk = []
  }

  for (const [originIndex, part] of (parts ?? []).entries()) {
    const source = part as {
      type?: unknown
      id?: unknown
      sourceKind?: unknown
      sourceId?: unknown
      url?: unknown
      title?: unknown
      mediaType?: unknown
      filename?: unknown
    }
    if (source.type !== 'source') {
      visualChunk.push(part)
      continue
    }
    const sourceKind = source.sourceKind === 'url' ? 'url' : source.sourceKind === 'document' ? 'document' : null
    if (!sourceKind || typeof source.sourceId !== 'string' || !source.sourceId.trim()) {
      visualChunk.push(part)
      continue
    }
    flushVisualChunk()
    const normalizedSource: ChatTranscriptSourceView = {
      id: typeof source.id === 'string' && source.id.trim() ? source.id : `source-${originIndex}`,
      sourceKind,
      sourceId: source.sourceId,
      ...(typeof source.url === 'string' && source.url ? { url: source.url } : {}),
      ...(typeof source.title === 'string' && source.title ? { title: source.title } : {}),
      ...(typeof source.mediaType === 'string' && source.mediaType ? { mediaType: source.mediaType } : {}),
      ...(typeof source.filename === 'string' && source.filename ? { filename: source.filename } : {}),
      originIndex,
    }
    sources.push(normalizedSource)
    blocks.push({
      kind: 'source',
      id: normalizedSource.id,
      sourceKind: normalizedSource.sourceKind,
      sourceId: normalizedSource.sourceId,
      ...(normalizedSource.url ? { url: normalizedSource.url } : {}),
      ...(normalizedSource.title ? { title: normalizedSource.title } : {}),
      ...(normalizedSource.mediaType ? { mediaType: normalizedSource.mediaType } : {}),
      ...(normalizedSource.filename ? { filename: normalizedSource.filename } : {}),
    })
  }
  flushVisualChunk()

  return { blocks, sources }
}

/** Copy persisted output results into renderer-safe generation result views. */
export function generationResultViewsFromOutputGroup(
  group: RestoredOutputGroup | null | undefined,
): GenerationResult[] {
  if (!group) return []
  return group.results.map((result) => ({
    ...result,
    type: group.type,
    status:
      result.status === 'completed'
        ? 'completed'
        : result.status === 'failed'
          ? 'failed'
          : 'generating',
  }))
}

export function transcriptResponseId(turnId: string, modelId: string, responseIndex: number): string {
  return `${turnId}:response:${modelId || responseIndex}`
}
