import type {
  AssistantVisualBlock,
  AssistantVisualSegment,
  AutomationDraftSummary,
  ChatMessageMetadata,
  ChatOutput,
  ConversationMessagePart,
  GenerationResult,
  LiveMessageDelta,
  MessageImageAttachment,
  MessageReasoningPart,
  MessageTextPart,
  MessageToolPart,
  RestoredOutputGroup,
  ServerConversationMessage,
  SkillDraftSummary,
  ToolGroupItem,
  ToolVisualBlock,
} from './types'
import {
  buildGeneratedUiPart,
  generatedUiDataToPlainText,
  isGeneratedUiPart,
} from './generated-ui'

export function getMessageText(msg: { parts?: Array<{ type: string; text?: string }> }): string {
  if (!msg.parts) return ''
  return msg.parts.filter((part) => part.type === 'text').map((part) => part.text || '').join('')
}

export function messageHasVisibleAssistantActivity(msg: {
  parts?: Array<{ type: string; text?: string; toolInvocation?: unknown; url?: string }>
}): boolean {
  return (msg.parts ?? []).some((part) => {
    if (part.type === 'text' || part.type === 'reasoning') return Boolean(part.text?.trim())
    if (isGeneratedUiPart(part)) return true
    if (part.type === 'tool-invocation') return Boolean(part.toolInvocation)
    if (part.type === 'file') return Boolean(part.url)
    return part.type.startsWith('tool-')
  })
}

export function chooseAssistantCandidate<T extends {
  role: string
  parts?: Array<{ type: string; text?: string; toolInvocation?: unknown; url?: string }>
}>(candidates: T[]): T | null {
  if (candidates.length === 0) return null
  return candidates.find(messageHasVisibleAssistantActivity) ?? candidates[candidates.length - 1]!
}

export function assistantBlocksToPlainText(blocks: AssistantVisualBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === 'text') return block.text
      if (block.kind === 'generated-ui') return generatedUiDataToPlainText(block.part.data)
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}

export function getDraftFromToolBlock(
  block: ToolVisualBlock,
): { kind: 'skill'; draft: SkillDraftSummary } | { kind: 'automation'; draft: AutomationDraftSummary } | null {
  const output =
    block.toolOutput && typeof block.toolOutput === 'object'
      ? (block.toolOutput as Record<string, unknown>)
      : null
  if (!output || output.success !== true) return null

  if (block.name === 'draft_skill_from_chat' && output.draft && typeof output.draft === 'object') {
    return { kind: 'skill', draft: output.draft as SkillDraftSummary }
  }
  if (block.name === 'draft_automation_from_chat' && output.draft && typeof output.draft === 'object') {
    return { kind: 'automation', draft: output.draft as AutomationDraftSummary }
  }
  return null
}

function buildAssistantVisualSegmentsRaw(blocks: AssistantVisualBlock[]): AssistantVisualSegment[] {
  const out: AssistantVisualSegment[] = []
  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]!
    if (block.kind === 'reasoning') {
      out.push({ kind: 'reasoning', block, originIndex: i })
      i++
      continue
    }
    if (block.kind === 'tool' && (block.name === 'browser_run_task' || block.name === 'interactive_browser_session')) {
      out.push({ kind: 'browser', block, originIndex: i })
      i++
      continue
    }
    if (block.kind === 'tool') {
      const start = i
      const group: ToolGroupItem[] = []
      while (i < blocks.length) {
        const item = blocks[i]!
        if (item.kind === 'tool') {
          if (item.name === 'browser_run_task' || item.name === 'interactive_browser_session') break
          group.push(item)
          i++
          continue
        }
        if (item.kind === 'reasoning') {
          group.push(item)
          i++
          continue
        }
        break
      }
      out.push({ kind: 'tools', items: group, originIndex: start })
      continue
    }
    if (block.kind === 'file') {
      out.push({ kind: 'file', block, originIndex: i })
      i++
      continue
    }
    if (block.kind === 'generated-ui') {
      out.push({ kind: 'generated-ui', block, originIndex: i })
      i++
      continue
    }
    if (block.kind === 'text') {
      out.push({ kind: 'text', block, originIndex: i })
      i++
      continue
    }
    i++
  }
  return out
}

export function buildAssistantVisualSegments(blocks: AssistantVisualBlock[]): AssistantVisualSegment[] {
  return buildAssistantVisualSegmentsRaw(blocks)
}

function isToolChainSegment(segment: AssistantVisualSegment): boolean {
  return segment.kind === 'browser' || segment.kind === 'tools'
}

export function computeToolChainFlags(segments: AssistantVisualSegment[]): Array<{ chainTop: boolean; chainBottom: boolean }> {
  return segments.map((segment, index) => ({
    chainTop: index > 0 && isToolChainSegment(segments[index - 1]!) && isToolChainSegment(segment),
    chainBottom:
      index < segments.length - 1 && isToolChainSegment(segment) && isToolChainSegment(segments[index + 1]!),
  }))
}

function extensionFromMediaType(mediaType?: string): string {
  if (!mediaType?.startsWith('image/')) return 'png'
  const subtype = mediaType.split('/')[1]?.split(';')[0]?.trim().toLowerCase()
  if (!subtype) return 'png'
  if (subtype === 'jpeg') return 'jpg'
  if (subtype === 'svg+xml') return 'svg'
  return subtype
}

export function getMessageImageAttachments(msg: {
  parts?: Array<{ type: string; url?: string; mediaType?: string; fileName?: string; filename?: string }>
}): MessageImageAttachment[] {
  if (!msg.parts) return []
  return msg.parts
    .filter((part) => part.type === 'file' && part.url && (part.mediaType?.startsWith('image/') ?? true))
    .map((part, index) => ({
      url: part.url!,
      name: part.fileName?.trim() || part.filename?.trim() || `image-${index + 1}.${extensionFromMediaType(part.mediaType)}`,
      ...(part.mediaType ? { mediaType: part.mediaType } : {}),
    }))
}

export function getMessageImages(msg: {
  parts?: Array<{ type: string; url?: string; mediaType?: string; fileName?: string; filename?: string }>
}): string[] {
  return getMessageImageAttachments(msg).map((attachment) => attachment.url)
}

/** Act assistant for a user turn: mirrors chat0 until streaming appends the assistant only to actChat. */
export function resolveActAssistant<
  T extends { id?: string; role: string; parts?: Array<{ type: string; text?: string; toolInvocation?: unknown; url?: string }> },
>(
  chat0Linear: Array<{ id?: string; role: string }>,
  actMsgs: T[],
  userMsgId: string,
): T | null {
  const i = chat0Linear.findIndex((m) => m.role === 'user' && m.id === userMsgId)
  if (i >= 0) {
    const candidates: T[] = []
    for (let j = i + 1; j < actMsgs.length; j++) {
      const m = actMsgs[j]!
      if (m.role === 'user') break
      if (m.role === 'assistant') candidates.push(m)
    }
    const selected = chooseAssistantCandidate(candidates)
    if (selected) return selected
  }
  const ui = actMsgs.findIndex((m) => m.id === userMsgId && m.role === 'user')
  if (ui >= 0) {
    const candidates: T[] = []
    for (let j = ui + 1; j < actMsgs.length; j++) {
      const m = actMsgs[j]!
      if (m.role === 'user') break
      if (m.role === 'assistant') candidates.push(m)
    }
    return chooseAssistantCandidate(candidates)
  }
  return null
}

export function generatedUiPartFromToolBlock(block: ToolVisualBlock) {
  if (block.name !== 'present_generated_ui') return null
  const output = block.toolOutput && typeof block.toolOutput === 'object'
    ? (block.toolOutput as Record<string, unknown>)
    : null
  if (!output || output.success !== true) return null
  const id =
    typeof output.id === 'string' && output.id.trim()
      ? output.id.trim()
      : block.key
  return buildGeneratedUiPart(id, output.generatedUi)
}

export function messagePartToGeneratedUiBlock(part: unknown): Extract<AssistantVisualBlock, { kind: 'generated-ui' }> | null {
  if (isGeneratedUiPart(part)) return { kind: 'generated-ui', part }
  return null
}

export function getUserMessageDocNames(msg: unknown): string[] {
  const message = msg as { metadata?: ChatMessageMetadata }
  const fromMeta = message.metadata?.indexedDocuments
  if (Array.isArray(fromMeta) && fromMeta.length > 0) return fromMeta
  return []
}

export function splitUserDisplayText(fullText: string): { bodyText: string; docNames: string[] } {
  const re = /\[Indexed documents:\s*([^\]]+)\]/g
  const docNames: string[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(fullText)) !== null) {
    docNames.push(...match[1]!.split(',').map((item) => item.trim()).filter(Boolean))
  }
  const bodyText = fullText.replace(re, '').replace(/\n{3,}/g, '\n\n').trim()
  return { bodyText, docNames }
}

export function getUserTurnId(msg: { id: string; turnId?: string }): string | null {
  if (typeof msg.turnId === 'string' && msg.turnId.trim()) return msg.turnId.trim()
  return msg.id?.trim() || null
}

export function getUserReplyThreadMeta(msg: unknown): { replyToTurnId: string; replySnippet: string } | null {
  const message = msg as {
    metadata?: ChatMessageMetadata
    replyToTurnId?: string
    replySnippet?: string
  }
  const turnId = message.metadata?.replyToTurnId?.trim() || message.replyToTurnId?.trim()
  if (!turnId) return null
  const snippet = (message.metadata?.replySnippet || message.replySnippet || 'Earlier message').trim()
  return { replyToTurnId: turnId, replySnippet: snippet }
}

export function getRoutedModelId(msg: unknown): string | null {
  const message = msg as {
    metadata?: ChatMessageMetadata
    routedModelId?: string
  }
  const routedModelId = message.metadata?.routedModelId?.trim() || message.routedModelId?.trim()
  return routedModelId || null
}

export function messageMatchesLocalTurn(msg: { id?: string; turnId?: string }, turnId: string): boolean {
  const persistedTurnId = msg.turnId?.trim()
  if (persistedTurnId) return persistedTurnId === turnId
  const localId = msg.id?.trim() || ''
  return localId === turnId || localId.startsWith(`${turnId}::`)
}

export function stripAssistantAfterUserTurn<TMessage extends { id?: string; role: string; turnId?: string }>(
  messages: TMessage[],
  turnId: string,
): TMessage[] {
  let userIdx = -1
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!
    if (message.role === 'user' && messageMatchesLocalTurn(message, turnId)) {
      userIdx = i
      break
    }
  }
  if (userIdx < 0) return messages
  let end = userIdx + 1
  while (end < messages.length && messages[end]!.role !== 'user') {
    end++
  }
  if (end === userIdx + 1) return messages
  return [...messages.slice(0, userIdx + 1), ...messages.slice(end)]
}

export function replaceAssistantForTurn<TMessage extends { id?: string; role: string; turnId?: string }>(
  messages: TMessage[],
  turnId: string,
  assistantFromServer: ServerConversationMessage,
): TMessage[] {
  const next = [...messages]
  let matchedUser = false
  for (let i = 0; i < next.length; i++) {
    const message = next[i]!
    if (message.role === 'user') {
      if (matchedUser) break
      matchedUser = messageMatchesLocalTurn(message, turnId)
      continue
    }
    if (matchedUser && message.role === 'assistant') {
      next[i] = assistantFromServer as unknown as TMessage
      return next
    }
  }
  return next
}

function isToolInvocationPart(part: Record<string, unknown>): part is Record<string, unknown> & {
  toolInvocation: {
    toolCallId?: string
    toolName?: string
    toolInput?: unknown
    toolOutput?: unknown
    state?: string
  }
} {
  return typeof part.toolInvocation === 'object' && part.toolInvocation !== null
}

export function mergeLiveStreamingParts(
  existingParts: Array<Record<string, unknown>>,
  newParts: Array<Record<string, unknown>>,
) {
  let nextParts = existingParts
  for (const part of newParts) {
    const last = nextParts[nextParts.length - 1]
    if (
      part.type === 'reasoning' &&
      last?.type === 'reasoning' &&
      typeof part.text === 'string'
    ) {
      nextParts = [
        ...nextParts.slice(0, -1),
        {
          ...last,
          text: `${typeof last.text === 'string' ? last.text : ''}${part.text}`,
          state: part.state ?? last.state,
        },
      ]
      continue
    }

    if (isToolInvocationPart(part)) {
      const incoming = part.toolInvocation
      const toolCallId = incoming.toolCallId
      if (toolCallId) {
        const existingIdx = nextParts.findIndex(
          (candidate) =>
            isToolInvocationPart(candidate) &&
            candidate.toolInvocation.toolCallId === toolCallId,
        )
        if (existingIdx >= 0) {
          const existing = nextParts[existingIdx]!
          if (isToolInvocationPart(existing)) {
            nextParts = [
              ...nextParts.slice(0, existingIdx),
              {
                type: 'tool-invocation',
                toolInvocation: {
                  ...existing.toolInvocation,
                  ...incoming,
                  toolName:
                    incoming.toolName === 'unknown_tool'
                      ? existing.toolInvocation.toolName
                      : incoming.toolName,
                  toolInput: incoming.toolInput ?? existing.toolInvocation.toolInput,
                  toolOutput: incoming.toolOutput ?? existing.toolInvocation.toolOutput,
                },
              },
              ...nextParts.slice(existingIdx + 1),
            ]
            continue
          }
        }
      }
    }

    nextParts = [...nextParts, part]
  }
  return nextParts
}

export function applyLiveMessageDeltaParts(
  existingParts: Array<Record<string, unknown>>,
  delta: LiveMessageDelta,
) {
  let nextParts = existingParts
  if (delta.textDelta) {
    const last = nextParts[nextParts.length - 1]
    if (last?.type === 'text') {
      nextParts = [
        ...nextParts.slice(0, -1),
        {
          ...last,
          text: `${typeof last.text === 'string' ? last.text : ''}${delta.textDelta}`,
        },
      ]
    } else {
      nextParts = [...nextParts, { type: 'text', text: delta.textDelta }]
    }
  }
  if (delta.newParts?.length) {
    nextParts = mergeLiveStreamingParts(nextParts, delta.newParts)
  }
  return nextParts
}

/**
 * Merge flattened {@link ConversationMessagePart} deltas into an existing part list.
 *
 * Unlike {@link mergeLiveStreamingParts} (which operates on AI SDK UI parts with
 * `tool-invocation` wrappers), this works on the flattened shared part shape used
 * by desktop streaming and persistence:
 *   - text: append to the trailing text part when present, otherwise push a new one
 *   - reasoning: append to the trailing streaming reasoning part, otherwise push
 *   - tool: merge by `toolCallId` (toolName, state, input, output, errorText)
 *   - file/source/data: push as-is
 *
 * Each delta part may omit `id`; an id is assigned based on its index when missing.
 */
export function mergeStreamingConversationParts(
  existingParts: ConversationMessagePart[],
  newParts: ConversationMessagePart[],
  idPrefix = 'part',
): ConversationMessagePart[] {
  let nextParts = [...existingParts]
  for (let i = 0; i < newParts.length; i++) {
    const part = newParts[i]!
    const ensured: ConversationMessagePart =
      part.id ? part : ({ ...part, id: `${idPrefix}:${existingParts.length + i}` } as ConversationMessagePart)

    if (ensured.type === 'text') {
      const last = nextParts[nextParts.length - 1]
      if (last?.type === 'text') {
        nextParts = [
          ...nextParts.slice(0, -1),
          { ...last, text: `${last.text}${ensured.text}` } satisfies MessageTextPart,
        ]
        continue
      }
      nextParts = [...nextParts, ensured]
      continue
    }

    if (ensured.type === 'reasoning') {
      const last = nextParts[nextParts.length - 1]
      if (last?.type === 'reasoning' && last.state === 'streaming') {
        nextParts = [
          ...nextParts.slice(0, -1),
          {
            ...last,
            text: `${last.text}${ensured.text}`,
            state: ensured.state === 'done' ? 'done' : last.state,
          } satisfies MessageReasoningPart,
        ]
        continue
      }
      nextParts = [...nextParts, ensured]
      continue
    }

    if (ensured.type === 'tool') {
      const existingIdx = nextParts.findIndex(
        (candidate): candidate is MessageToolPart =>
          candidate.type === 'tool' && candidate.toolCallId === ensured.toolCallId,
      )
      if (existingIdx >= 0) {
        const existing = nextParts[existingIdx] as MessageToolPart
        nextParts = [
          ...nextParts.slice(0, existingIdx),
          {
            ...existing,
            toolName:
              ensured.toolName === 'unknown_tool' ? existing.toolName : ensured.toolName,
            state: ensured.state,
            input: ensured.input ?? existing.input,
            inputText: ensured.inputText ?? existing.inputText,
            output: ensured.output ?? existing.output,
            errorText: ensured.errorText ?? existing.errorText,
            providerExecuted: ensured.providerExecuted ?? existing.providerExecuted,
            dynamic: ensured.dynamic ?? existing.dynamic,
            title: ensured.title ?? existing.title,
          } satisfies MessageToolPart,
          ...nextParts.slice(existingIdx + 1),
        ]
        continue
      }
      nextParts = [...nextParts, ensured]
      continue
    }

    nextParts = [...nextParts, ensured]
  }
  return nextParts
}

/** Mark all streaming reasoning parts as done (call once when a stream finishes). */
export function finalizeStreamingConversationParts(
  parts: ConversationMessagePart[],
): ConversationMessagePart[] {
  return parts.map((part) =>
    part.type === 'reasoning' && part.state === 'streaming'
      ? { ...part, state: 'done' } satisfies MessageReasoningPart
      : part,
  )
}

const CONNECTION_LOST_LABEL =
  'Connection lost mid-response. Check your network and try again.'

/** True when `message` is a short stored failure string, not leftover assistant prose. */
export function looksLikeStoredGenerationError(message: string): boolean {
  const text = message.trim()
  if (!text) return false
  if (text.length > 220) return false
  if (
    /^(Generation failed\.?|generation_interrupted_|weekly_limit|premium_model|generation_not_allowed|insufficient_credits|storage_limit_exceeded|bandwidth_limit_exceeded)/i.test(
      text,
    )
  ) {
    return true
  }
  if (
    /failed to fetch|networkerror|load failed|err_internet|err_name_not_resolved|websocket|connection (lost|failed|closed|reset)|internet disconnected|network (error|request failed)|ECONNRESET|ETIMEDOUT|AbortError|The operation was aborted/i.test(
      text,
    )
  ) {
    return true
  }
  if (
    text.includes('OpenRouter') ||
    text.includes('AI Gateway') ||
    text.includes('model provider') ||
    /gateway.*(auth|key|billing|quota|limit)|provider.*(blocked|billing|quota|limit)/i.test(text) ||
    /model.*not found|not found.*model|model_not_found/i.test(text)
  ) {
    return true
  }
  // Conversational / markdown assistant output kept after an interrupted stream.
  if (/[.!?]/.test(text) && text.split(/\s+/).length >= 12) return false
  return text.length <= 160
}

/**
 * When a message is marked `status: 'error'`, Convex often keeps the partial
 * assistant reply in `content`. Only treat that text as the error when it looks
 * like a real failure string; otherwise surface a connection/interrupt label.
 */
export function persistedGenerationErrorMessage(responseText: string | null | undefined): string {
  const text = responseText?.trim() ?? ''
  if (!text) return 'Generation failed'
  if (looksLikeStoredGenerationError(text)) return text
  return 'generation_interrupted_connection'
}

export function errorLabel(err: Error | null | undefined): string | null {
  if (!err) return null
  const message = err.message || ''
  if (
    message.includes('OpenRouter') ||
    message.includes('AI Gateway') ||
    message.includes('model provider') ||
    message.includes('rate-limited') ||
    message.includes('rate limit') ||
    message.includes('spend limit') ||
    message.includes('Payment Required') ||
    message.includes('payment required') ||
    message.includes('insufficient credits')
  ) {
    return message
  }
  if (/gateway.*(auth|key|billing|quota|limit)|provider.*(blocked|billing|quota|limit)/i.test(message)) return message
  if (message.includes('weekly_limit')) return 'Weekly limit reached - upgrade to a paid plan for unlimited messages.'
  if (message.includes('premium_model')) return 'This model requires a paid plan.'
  if (message.includes('generation_not_allowed')) return 'This action requires a paid plan.'
  if (message.includes('insufficient_credits')) return 'No budget remaining.'
  if (message.includes('storage_limit_exceeded')) return 'Overlay storage limit reached. Delete files or outputs, or upgrade your plan.'
  if (message.includes('bandwidth_limit_exceeded')) return 'File bandwidth limit reached for this billing period.'
  if (message.includes('generation_interrupted_server_timeout')) {
    return 'Generation was interrupted by the server. Try sending your message again.'
  }
  if (
    message.includes('generation_interrupted_connection') ||
    /failed to fetch|networkerror|load failed|err_internet|err_name_not_resolved|websocket|connection (lost|failed|closed|reset)|internet disconnected|network (error|request failed)|ECONNRESET|ETIMEDOUT/i.test(
      message,
    )
  ) {
    return CONNECTION_LOST_LABEL
  }
  if (message.includes('supported image formats') || message.includes('does not represent a valid image')) {
    return 'Unsupported image format. Use JPEG, PNG, GIF, or WebP.'
  }
  if (/model.*not found|not found.*model|model_not_found/i.test(message)) {
    return 'That model is not available from the provider right now. Try another model.'
  }
  return 'Something went wrong. Please try again.'
}

export function chatGreetingLine(firstName: string | undefined) {
  const raw = firstName?.trim()
  if (!raw) return 'Hi there!'
  const word = raw.split(/\s+/)[0] ?? raw
  const nice = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  return `Hi ${nice}!`
}

export function sanitizeEmptyChatStarters(prompts: string[], firstName?: string): string[] {
  const trimmedFirstName = firstName?.trim()
  const firstNamePattern = trimmedFirstName
    ? new RegExp(`\\b${trimmedFirstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    : null

  return prompts
    .filter((prompt) => typeof prompt === 'string')
    .map((prompt) => prompt.trim())
    .filter((prompt) => prompt.length > 0)
    .filter((prompt) => !/\boverlay\b/i.test(prompt))
    .filter((prompt) => !(firstNamePattern?.test(prompt) ?? false))
    .slice(0, 4)
}

export function groupOutputsIntoExchanges(outputs: ChatOutput[]): RestoredOutputGroup[] {
  const isMediaOutput = (output: ChatOutput): output is ChatOutput & { type: 'image' | 'video' } =>
    output.type === 'image' || output.type === 'video'

  const sorted = outputs.filter(isMediaOutput).sort((a, b) => a.createdAt - b.createdAt)
  const groups: RestoredOutputGroup[] = []

  for (const output of sorted) {
    const prev = groups[groups.length - 1]
    const normalizedTurnId = output.turnId?.trim() || null
    const shouldMerge =
      prev &&
      prev.type === output.type &&
      (
        (normalizedTurnId && prev.turnId === normalizedTurnId) ||
        (
          !normalizedTurnId &&
          !prev.turnId &&
          prev.prompt === output.prompt &&
          Math.abs(output.createdAt - prev.createdAt) < 60_000
        )
      )

    const result: GenerationResult = {
      type: output.type,
      status:
        output.status === 'pending'
          ? 'generating'
          : output.status === 'completed'
          ? 'completed'
          : 'failed',
      url: output.url,
      modelUsed: output.modelId,
      outputId: output._id,
      error: output.status === 'failed' ? 'Generation failed' : undefined,
    }

    if (shouldMerge) {
      prev.modelIds.push(output.modelId)
      prev.results.push(result)
      continue
    }

    groups.push({
      type: output.type,
      prompt: output.prompt,
      modelIds: [output.modelId],
      results: [result],
      createdAt: output.createdAt,
      turnId: normalizedTurnId,
    })
  }

  return groups
}

export function buildMediaSummary(
  type: 'image' | 'video',
  prompt: string,
  modelIds: string[],
  completedCount: number,
  failedCount: number,
): string {
  const noun = type === 'image'
    ? (completedCount === 1 ? 'image' : 'images')
    : (completedCount === 1 ? 'video' : 'videos')
  const modelList = modelIds.join(', ')
  const failureSuffix = failedCount > 0 ? ` ${failedCount} generation${failedCount === 1 ? '' : 's'} failed.` : ''
  return `Generated ${completedCount} ${noun} for the prompt "${prompt}" using ${modelList}.${failureSuffix}`
}
