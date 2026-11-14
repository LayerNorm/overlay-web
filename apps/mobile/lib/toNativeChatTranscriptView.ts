import {
  deriveChatExchangeStatus,
  generationResultViewsFromOutputGroup,
  getUserMessageDocNames,
  groupTranscriptMessages,
  collectWebSourcesFromBlocks,
  normalizeTranscriptAssistantParts,
  selectTranscriptResponse,
  splitUserDisplayText,
  transcriptResponseId,
  type ActiveRunState,
  type AssistantVisualBlock,
  type ChatExchangeStatus,
  type ChatTranscriptExchangeView,
  type ChatTranscriptImageView,
  type ChatTranscriptResponseView,
  type ChatTranscriptSourceView,
  type ChatTranscriptUserView,
  type ChatTranscriptView,
  type GenerationMode,
  type GenerationResult,
  type RestoredOutputGroup,
} from '@overlay/chat-core'
import { completePersonalBlocks } from './personalStream'
import { MAX_NATIVE_TRANSCRIPT_SOURCE_COUNT } from './nativeTranscriptLimits'
import { safePublicUrl } from './nativeChatTranscriptProjection'
import type { Message, NativeMessageStatus, ProviderResponse } from '../services/chatTypes'

export interface NativeChatTranscriptRuntime {
  activeTurnId?: string
  status?: ActiveRunState['status'] | 'submitted' | 'error'
  interrupted?: boolean
  error?: string | null
}

interface ResponseCandidate {
  message: Message
  response: ProviderResponse | null
  modelId: string
  variantIndex?: number
  ownsTopLevelFields: boolean
}

function responseCandidates(messages: readonly Message[]): ResponseCandidate[] {
  return messages.flatMap((message) => {
    const providerResponses = message.responses?.length ? message.responses : [null]
    const topLevelModelId = message.selectedModelId &&
      providerResponses.some((response) => response?.modelId === message.selectedModelId)
      ? message.selectedModelId
      : message.modelId
    const topLevelIndex = providerResponses.length === 1
      ? 0
      : topLevelModelId
        ? providerResponses.findLastIndex((response) => response?.modelId === topLevelModelId)
        : -1
    return providerResponses.map((response, responseIndex) => {
      const modelId = response?.modelId || message.modelId || message.selectedModelId || message.routedModelId || 'overlay'
      return {
        message,
        response,
        modelId,
        variantIndex: response?.variantIndex ??
          (providerResponses.length === 1 ? message.variantIndex : undefined),
        ownsTopLevelFields: responseIndex === topLevelIndex,
      }
    })
  })
}

function responseVariantIndices(candidates: readonly ResponseCandidate[]): number[] {
  const reserved = new Map<string, Set<number>>()
  for (const candidate of candidates) {
    const index = candidate.variantIndex
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) continue
    const indices = reserved.get(candidate.modelId) ?? new Set<number>()
    indices.add(index)
    reserved.set(candidate.modelId, indices)
  }
  const used = new Map<string, Set<number>>()
  return candidates.map((candidate) => {
    const indices = used.get(candidate.modelId) ?? new Set<number>()
    used.set(candidate.modelId, indices)
    const explicit = candidate.variantIndex
    if (typeof explicit === 'number' && Number.isInteger(explicit) && explicit >= 0 && !indices.has(explicit)) {
      indices.add(explicit)
      return explicit
    }
    let next = 0
    while (indices.has(next) || reserved.get(candidate.modelId)?.has(next)) next += 1
    indices.add(next)
    return next
  })
}

function terminalState(status: NativeMessageStatus | undefined): 'completed' | 'error' | 'interrupted' | undefined {
  if (status === 'completed') return 'completed'
  if (status === 'error' || status === 'failed') return 'error'
  if (status === 'interrupted') return 'interrupted'
  return undefined
}

function sourceViewsFromBlocks(blocks: readonly AssistantVisualBlock[]): ChatTranscriptSourceView[] {
  return blocks.flatMap((block, originIndex) => block.kind === 'source'
    ? [{
        id: block.id,
        sourceKind: block.sourceKind,
        sourceId: block.sourceId,
        ...(block.url ? { url: block.url } : {}),
        ...(block.title ? { title: block.title } : {}),
        ...(block.mediaType ? { mediaType: block.mediaType } : {}),
        ...(block.filename ? { filename: block.filename } : {}),
        originIndex,
      }]
    : [])
}

function sourceHash(value: string): string {
  let first = 2_166_136_261
  let second = 2_654_435_761
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 16_777_619)
    second = Math.imul(second ^ code, 2_246_822_519)
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`
}

function webSourceViewsFromBlocks(
  blocks: readonly AssistantVisualBlock[],
  responseId: string,
): ChatTranscriptSourceView[] {
  const sources: ChatTranscriptSourceView[] = []
  const seen = new Set<string>()
  blocks.forEach((block, originIndex) => {
    if (sources.length >= MAX_NATIVE_TRANSCRIPT_SOURCE_COUNT || block.kind !== 'tool') return
    for (const item of collectWebSourcesFromBlocks([block])) {
      const url = safePublicUrl(item.url)
      if (!url || seen.has(url)) continue
      seen.add(url)
      const id = `web-${sourceHash(`${responseId}\u0000${url}`)}`
      const title = item.title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 512) || url
      sources.push({ id, sourceKind: 'url', sourceId: id, url, title, originIndex })
      if (sources.length >= MAX_NATIVE_TRANSCRIPT_SOURCE_COUNT) break
    }
  })
  return sources
}

function mergeWebSourceViews(
  existing: readonly ChatTranscriptSourceView[],
  webSources: readonly ChatTranscriptSourceView[],
): ChatTranscriptSourceView[] {
  const merged = [...existing]
  const seen = new Set(existing.flatMap((source) => {
    if (source.sourceKind !== 'url') return []
    const url = safePublicUrl(source.url)
    return url ? [url] : []
  }))
  for (const source of webSources) {
    if (merged.length >= MAX_NATIVE_TRANSCRIPT_SOURCE_COUNT) break
    const url = safePublicUrl(source.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    merged.push(source)
  }
  return merged.slice(0, MAX_NATIVE_TRANSCRIPT_SOURCE_COUNT)
}

function fallbackParts(
  content: string,
  reasoning?: string,
  tools?: Message['toolInvocations'],
  files?: Message['generatedFiles'],
): unknown[] {
  const parts: unknown[] = []
  if (content) parts.push({ type: 'text', text: content })
  if (reasoning) parts.push({ type: 'reasoning', text: reasoning })
  for (const tool of tools ?? []) {
    parts.push({
      type: 'tool-invocation',
      toolInvocation: {
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        state: tool.state,
        toolInput: tool.toolInput,
        toolOutput: tool.toolOutput,
      },
    })
  }
  for (const file of files ?? []) {
    parts.push({ type: 'file', url: file.url, mediaType: file.mediaType })
  }
  return parts
}

function preserveSourceToolStates(
  blocks: AssistantVisualBlock[],
  tools: Message['toolInvocations'] | undefined,
): AssistantVisualBlock[] {
  if (!tools) return blocks
  const invocations = new Map(tools.flatMap((tool) => tool.toolCallId
    ? [[tool.toolCallId, tool] as const]
    : []))
  return blocks.map((block) => {
    if (block.kind !== 'tool') return block
    const invocation = invocations.get(block.key)
    if (!invocation || invocation.state === 'output-available') return block
    if (collectWebSourcesFromBlocks([{ ...block, state: 'output-available' }]).length === 0) return block
    if (typeof invocation.state === 'string') return { ...block, state: invocation.state }
    return {
      ...block,
      toolOutput: undefined,
    }
  })
}

function responseStatus(
  candidate: ResponseCandidate,
  isActive: boolean,
  isSelected: boolean,
  runtime: NativeChatTranscriptRuntime | undefined,
  blocks: readonly AssistantVisualBlock[],
  content: string,
  errorMessage: string | undefined,
): ChatExchangeStatus {
  const response = candidate.response
  const status = response?.status ?? (candidate.ownsTopLevelFields ? candidate.message.status : undefined)
  const localStreaming = Boolean(
    response?.isLoading ||
    (candidate.ownsTopLevelFields && candidate.message.isStreaming) ||
    status === 'generating',
  )
  const activeResponse = isActive && isSelected
  const runtimeStatus = activeResponse && runtime?.status
    ? runtime.status
    : localStreaming
      ? 'streaming'
      : status === 'submitted'
        ? 'submitted'
        : undefined
  const persistedStatus = activeResponse && runtime?.status
    ? undefined
    : status === 'generating' || status === 'submitted' || status === 'interrupted'
      ? undefined
      : status
  return deriveChatExchangeStatus({
    runtimeStatus,
    persistedStatus,
    hasResponse: true,
    hasVisibleContent: Boolean(content.trim()) || blocks.length > 0,
    interrupted: (activeResponse && Boolean(runtime?.interrupted)) || status === 'interrupted',
    error: (activeResponse && runtime?.error ? 'This response could not be completed.' : undefined) ||
      (errorMessage ? 'This response could not be completed.' : undefined),
  })
}

function responseView(
  candidate: ResponseCandidate,
  variantIndex: number,
  turnId: string,
  isActive: boolean,
  isSelected: boolean,
  runtime: NativeChatTranscriptRuntime | undefined,
): ChatTranscriptResponseView {
  const { message, response } = candidate
  const ownsTopLevel = candidate.ownsTopLevelFields
  const responseId = `${transcriptResponseId(turnId, candidate.modelId, variantIndex)}:${variantIndex}`
  const content = response?.content ?? (ownsTopLevel ? message.content : '')
  const reasoning = response?.reasoning ?? (ownsTopLevel ? message.reasoning : undefined)
  const tools = response?.toolInvocations ?? (ownsTopLevel ? message.toolInvocations : undefined)
  const files = response?.generatedFiles ?? (ownsTopLevel ? message.generatedFiles : undefined)
  const status = response?.status ?? (ownsTopLevel ? message.status : undefined)
  const errorMessage = response?.error ?? (ownsTopLevel ? message.errorMessage : undefined)
  let blocks = response?.blocks ?? (ownsTopLevel ? message.blocks : undefined)
  const hasCanonicalBlocks = blocks !== undefined
  let sources = response?.sources ?? (ownsTopLevel ? message.transcriptSources : undefined)
  const sourceCitations = response?.sourceCitations ?? (ownsTopLevel ? message.sourceCitations : undefined)

  if (!blocks || (blocks.length === 0 && content.trim())) {
    const normalized = normalizeTranscriptAssistantParts(
      fallbackParts(content, reasoning, tools, files),
      { ...(terminalState(status) ? { terminalState: terminalState(status) } : {}) },
    )
    blocks = normalized.blocks
    sources ??= normalized.sources
  }
  blocks = preserveSourceToolStates(blocks, tools)
  sources = mergeWebSourceViews(sources ?? sourceViewsFromBlocks(blocks), webSourceViewsFromBlocks(blocks, responseId))

  const responseStreaming = Boolean(
    response?.isLoading ||
    (ownsTopLevel && message.isStreaming) ||
    status === 'generating',
  )
  const blocksAreComplete = response?.blocksAreComplete ??
    (ownsTopLevel ? message.blocksAreComplete : undefined) ??
    !responseStreaming
  if (responseStreaming && !blocksAreComplete) {
    if (hasCanonicalBlocks) {
      blocks = completePersonalBlocks(blocks, true)
    } else {
      const textBlocks = completePersonalBlocks(blocks.filter((block) => block.kind === 'text'), true)
      let textIndex = 0
      blocks = blocks.map((block) => block.kind === 'text' ? textBlocks[textIndex++]! : block)
    }
  }

  const activeError = isActive && isSelected && runtime?.error ? 'This response could not be completed.' : undefined
  const safeErrorMessage = errorMessage ? 'This response could not be completed.' : undefined
  return {
    id: responseId,
    modelId: candidate.modelId,
    blocks,
    sources,
    ...(sourceCitations ? { sourceCitations: { ...sourceCitations } } : {}),
    ...(response?.routedModelId || (ownsTopLevel ? message.routedModelId : undefined)
      ? { routedModelId: response?.routedModelId ?? message.routedModelId }
      : {}),
    status: responseStatus(
      candidate,
      isActive,
      isSelected,
      runtime,
      blocks,
      content,
      activeError ?? safeErrorMessage,
    ),
    errorMessage: activeError ?? safeErrorMessage ?? null,
  }
}

function userView(message: Message | null, turnId: string): ChatTranscriptUserView {
  if (!message) {
    return {
      id: `${turnId}:user`,
      text: '',
      documentNames: [],
      indexedAttachments: [],
      images: [],
      mentions: [],
      replyThread: null,
    }
  }
  const { bodyText, docNames } = splitUserDisplayText(message.content)
  const indexedAttachments = (message.indexedAttachments ?? []).map((attachment) => ({
    name: attachment.name,
    fileIds: [...attachment.fileIds],
  }))
  const documentNames = [...new Set([
    ...getUserMessageDocNames({
      content: message.content,
      metadata: {
        indexedDocuments: message.indexedDocuments,
        indexedAttachments,
      },
    }),
    ...docNames,
    ...indexedAttachments.map((attachment) => attachment.name),
  ])]
  const images = new Map<string, ChatTranscriptImageView>()
  for (const image of message.imageAttachments ?? []) images.set(image.url, { ...image })
  for (const screenshot of message.screenshots ?? []) {
    images.set(screenshot.uri, { url: screenshot.uri, name: screenshot.name })
  }
  if (message.imageData && !images.has(message.imageData)) {
    const mediaType = message.imageData.match(/^data:([^;,]+)/)?.[1]
    images.set(message.imageData, {
      url: message.imageData,
      name: 'image',
      ...(mediaType ? { mediaType } : {}),
    })
  }
  return {
    id: message.id,
    text: bodyText,
    documentNames,
    indexedAttachments,
    images: [...images.values()],
    mentions: (message.mentions ?? []).map((mention) => ({
      type: mention.type,
      id: mention.id,
      name: mention.name,
      ...(mention.fileIds ? { fileIds: [...mention.fileIds] } : {}),
    })),
    replyThread: message.replyToTurnId
      ? { replyToTurnId: message.replyToTurnId, replySnippet: message.replySnippet ?? '' }
      : null,
    createdAt: message.timestamp,
  }
}

function mediaView(
  messages: readonly (Message | null)[],
  generationMode: GenerationMode,
  turnId: string,
): ChatTranscriptExchangeView['media'] {
  const outputsById = new Map<string, NonNullable<Message['outputs']>[number]>()
  for (const message of messages) {
    for (const output of message?.outputs ?? []) outputsById.set(output._id, output)
  }
  const grouped = new Map<'image' | 'video', NonNullable<Message['outputs']>>()
  for (const output of outputsById.values()) {
    if (output.type !== 'image' && output.type !== 'video') continue
    const type = output.type
    const outputs = grouped.get(type) ?? []
    outputs.push(output)
    grouped.set(type, outputs)
  }
  if (grouped.size === 0) {
    if (generationMode !== 'image' && generationMode !== 'video') return null
    const userMessage = messages.find((message) => message?.role === 'user' && message.turnId === turnId)
    const assistantMessage = messages.find((message) => message?.role === 'assistant' && message.turnId === turnId)
    if (!userMessage || !assistantMessage) return null
    const failed = assistantMessage.status === 'error' || assistantMessage.status === 'interrupted' ||
      assistantMessage.responses?.some(response => response.status === 'error' || response.status === 'interrupted') === true
    const generating = assistantMessage.isStreaming || assistantMessage.responses?.some(response => response.isLoading) === true
    const modelUsed = assistantMessage.responses?.find(response => response.modelId)?.modelId ?? assistantMessage.selectedModelId ?? assistantMessage.modelId
    const result: GenerationResult = {
      type: generationMode,
      status: failed ? 'failed' : generating ? 'generating' : 'completed',
      ...(modelUsed ? { modelUsed } : {}),
    }
    return { kind: generationMode, results: [result] }
  }

  const groups: RestoredOutputGroup[] = [...grouped].map(([type, outputs]) => ({
    type,
    prompt: outputs[0]?.prompt ?? '',
    modelIds: [...new Set(outputs.map((output) => output.modelId))],
    results: outputs.map((output): GenerationResult => ({
      type,
      status: output.status === 'pending' ? 'generating' : output.status,
      ...(output.url ? { url: output.url } : {}),
      modelUsed: output.modelId,
      outputId: output._id,
    })),
    createdAt: Math.min(...outputs.map((output) => output.createdAt)),
    turnId,
  }))
  const preferredKind = generationMode === 'image' || generationMode === 'video'
    ? generationMode
    : groups[0]!.type
  return {
    kind: preferredKind,
    results: groups.flatMap((group) => generationResultViewsFromOutputGroup(group)),
  }
}

function mediaStatus(results: readonly GenerationResult[]): ChatExchangeStatus {
  if (results.some((result) => result.status === 'failed')) return 'error'
  if (results.some((result) => result.status === 'generating')) return 'streaming'
  if (results.length > 0 && results.every((result) => result.status === 'completed')) return 'completed'
  return 'idle'
}

function exchangeStatus(
  selectedResponse: ChatTranscriptResponseView | undefined,
  hasResponse: boolean,
  generationMode: GenerationMode,
  media: ChatTranscriptExchangeView['media'],
  isActive: boolean,
  runtime: NativeChatTranscriptRuntime | undefined,
): ChatExchangeStatus {
  if (generationMode !== 'text') return mediaStatus(media?.results ?? [])
  if (selectedResponse) return selectedResponse.status
  return deriveChatExchangeStatus({
    ...(isActive && runtime?.status ? { runtimeStatus: runtime.status } : {}),
    hasResponse,
    interrupted: isActive && Boolean(runtime?.interrupted),
    error: isActive ? runtime?.error : undefined,
  })
}

export function toNativeChatTranscriptView(
  messages: readonly Message[],
  runtime?: NativeChatTranscriptRuntime,
): ChatTranscriptView {
  const groups = groupTranscriptMessages(messages)
  const runtimeHasState = Boolean(runtime?.status || runtime?.interrupted || runtime?.error)
  const activeTurnId = runtime?.activeTurnId ?? (runtimeHasState ? groups.at(-1)?.turnId : undefined)
  const exchanges = groups.map((group, index): ChatTranscriptExchangeView => {
    const candidates = responseCandidates(group.assistants)
    const explicitSelectedModelId = group.user?.selectedModelId ??
      group.assistants.find((message) => message.selectedModelId)?.selectedModelId
    const initialSelection = selectTranscriptResponse(candidates, {
      ...(explicitSelectedModelId ? { selectedModelId: explicitSelectedModelId } : {}),
    })
    const selectedModel = initialSelection.response?.modelId
    const latestSelectedIndex = selectedModel
      ? candidates.findLastIndex((candidate) => candidate.modelId === selectedModel)
      : initialSelection.index
    const selection = latestSelectedIndex >= 0
      ? selectTranscriptResponse(candidates, { selectedIndex: latestSelectedIndex })
      : initialSelection
    const variantIndices = responseVariantIndices(candidates)
    const isActive = group.turnId === activeTurnId
    const responses = candidates.map((candidate, responseIndex) =>
      responseView(
        candidate,
        variantIndices[responseIndex]!,
        group.turnId,
        isActive,
        responseIndex === selection.index,
        runtime,
      ),
    )
    const generationMode = group.user?.contentType ??
      group.assistants.find((message) => message.contentType)?.contentType ??
      'text'
    const media = mediaView([group.user, ...group.assistants], generationMode, group.turnId)
    return {
      id: group.turnId,
      turnId: group.turnId,
      index,
      mode: group.user?.mode ?? group.assistants.find((message) => message.mode)?.mode ?? 'act',
      generationMode,
      user: userView(group.user, group.turnId),
      responses,
      selectedResponseIndex: selection.index,
      selectedModelId: explicitSelectedModelId ?? selection.response?.modelId ?? null,
      status: exchangeStatus(
        responses[selection.index],
        responses.length > 0,
        generationMode,
        media,
        isActive,
        runtime,
      ),
      media,
    }
  })
  return { version: 1, exchanges }
}
