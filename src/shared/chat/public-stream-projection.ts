import { transcriptPartIdentity } from './transcript-part-identity'
import type { GeneratedJsonRenderData } from '@overlay/chat-core/generated-ui'

export type PublicStreamPreviewData = Omit<GeneratedJsonRenderData, 'streaming'> & { streaming: true }
export type PublicStreamPreviewUpdate = {
  toolCallId: string
  order: number
  sequence: number
  textOffset: number
  data?: PublicStreamPreviewData
}
export type ActivePublicStreamPreview = PublicStreamPreviewUpdate & { data: PublicStreamPreviewData }

export type ActivePublicStreamSnapshot = {
  assistantMessageId: string
  runId: string
  executionGeneration: number
  receiptId: string
  invocation: number
  sequence: number
  revision?: number
  text: string
  truncatedMarker?: string
  status?: string
  /** The streaming call continues text the previous call stopped mid-output. */
  continuesPrevious?: boolean
  previews?: ActivePublicStreamPreview[]
}
export type PublicStreamCheckpoint = Pick<ActivePublicStreamSnapshot, 'runId' | 'executionGeneration' | 'receiptId' | 'invocation'>

type MessageWithParts = {
  content: string
  parts?: readonly unknown[]
  status?: string
  publicStreamCheckpoint?: PublicStreamCheckpoint
} & ({ _id: string; id?: string } | { id: string; _id?: string })

type PublicStreamProjectionPart = {
  source?: unknown
  runId?: unknown
  executionGeneration?: unknown
  receiptId?: unknown
  invocation?: unknown
  sequence?: unknown
  revision?: unknown
  renderedContent?: unknown
  baseContent?: unknown
  /** The base text part this projection extended in place, restored when it retires. */
  continuedPart?: unknown
}

function isPublicStreamProjectionPart(part: unknown): part is PublicStreamProjectionPart {
  return Boolean(part && typeof part === 'object'
    && 'source' in part && ['public-stream', 'public-stream-preview'].includes(String((part as { source?: unknown }).source)))
}

function checkpointSupersedesStream(
  checkpoint: PublicStreamCheckpoint | undefined,
  stream: ActivePublicStreamSnapshot,
): boolean {
  if (!checkpoint) return false
  const matches = checkpoint.runId === stream.runId
    && checkpoint.executionGeneration === stream.executionGeneration
    && checkpoint.receiptId === stream.receiptId && checkpoint.invocation === stream.invocation
  const isNewer = checkpoint.executionGeneration > stream.executionGeneration
    || (checkpoint.executionGeneration === stream.executionGeneration && checkpoint.invocation > stream.invocation)
  return matches || isNewer
}

function priorProjectionIsNewer(
  priorPart: PublicStreamProjectionPart | undefined,
  stream: ActivePublicStreamSnapshot,
): boolean {
  if (priorPart?.runId !== stream.runId || typeof priorPart.executionGeneration !== 'number') return false
  if (priorPart.executionGeneration > stream.executionGeneration) return true
  if (priorPart.executionGeneration !== stream.executionGeneration) return false
  if (typeof priorPart.invocation !== 'number' || priorPart.invocation < stream.invocation) return false
  if (priorPart.invocation > stream.invocation) return true
  if (typeof priorPart.revision === 'number' && typeof stream.revision === 'number') return priorPart.revision > stream.revision
  return typeof priorPart.sequence === 'number' && priorPart.sequence > stream.sequence
}

function getBaseContent(message: MessageWithParts, priorPart: PublicStreamProjectionPart | undefined): string {
  return priorPart && typeof priorPart.renderedContent === 'string'
    && message.content === priorPart.renderedContent && typeof priorPart.baseContent === 'string'
    ? priorPart.baseContent
    : message.content
}

function getBaseParts(message: MessageWithParts, hasPriorPart: boolean): readonly unknown[] | undefined {
  return hasPriorPart ? message.parts?.flatMap(part => {
    if (!isPublicStreamProjectionPart(part)) return [part]
    return part.continuedPart && typeof part.continuedPart === 'object' ? [part.continuedPart] : []
  }) : message.parts
}

function getSettledPreviewIds(parts: readonly unknown[]): Set<string> {
  const settled = new Set<string>()
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    const record = part as { type?: unknown; id?: unknown; toolCallId?: unknown; state?: unknown; data?: { streaming?: unknown }; toolInvocation?: { toolCallId?: unknown; state?: unknown } }
    if (record.type === 'data' && typeof record.id === 'string' && record.data?.streaming !== true) settled.add(record.id)
    const toolCallId = record.toolCallId ?? record.toolInvocation?.toolCallId
    const state = record.state ?? record.toolInvocation?.state
    if (record.type === 'tool-invocation' && typeof toolCallId === 'string'
      && !['input-streaming', 'input-available'].includes(String(state))) settled.add(toolCallId)
  }
  return settled
}

function isTextPart(part: unknown): part is { type: 'text'; text: string } {
  return Boolean(part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
    && typeof (part as { text?: unknown }).text === 'string')
}

function hasPartId(part: unknown): boolean {
  return Boolean(part && typeof part === 'object' && typeof (part as { id?: unknown }).id === 'string')
}

/**
 * Where the live text goes. Tools the running call has started are stored at the
 * end of the row before its step settles, without the ids settled transcript parts
 * carry. The live text was written before those calls, so it goes ahead of them.
 */
function liveTextIndex(parts: readonly unknown[]): number {
  let index = parts.length
  while (index > 0) {
    const part = parts[index - 1] as { type?: unknown } | undefined
    if (part?.type !== 'tool-invocation' || hasPartId(part)) break
    index -= 1
  }
  return index
}

function restoreRenderedProjection<T extends MessageWithParts>(
  message: T,
  priorPart: PublicStreamProjectionPart | undefined,
  baseContent: string,
  baseParts: readonly unknown[] | undefined,
): T {
  if (!priorPart) return message
  return { ...message, content: message.content === priorPart.renderedContent ? baseContent : message.content, parts: baseParts } as T
}

function retireCheckpointedProjection<T extends MessageWithParts>(
  message: T,
  priorPart: PublicStreamProjectionPart | undefined,
  baseContent: string,
  baseParts: readonly unknown[] | undefined,
): T {
  if (!priorPart) return message
  return message.content === priorPart.renderedContent
    ? { ...message, content: baseContent, parts: baseParts } as T
    : { ...message, parts: baseParts } as T
}

function projectPreviewParts(
  settled: readonly unknown[], previews: readonly ActivePublicStreamPreview[], part: Record<string, unknown>,
  projectionId: string, text: string, baseContent: string, renderedContent: string,
  stream: ActivePublicStreamSnapshot,
): unknown[] {
  if (!previews.length) return [part]
  const settledIds = getSettledPreviewIds(settled)
  let cursor = 0
  let block = 0
  const projected: unknown[] = []
  const appendText = (end: number) => {
    const next = Math.max(cursor, Math.min(text.length, end))
    if (next > cursor) projected.push({ ...part, id: `${projectionId}:text:${block++}`, text: text.slice(cursor, next) })
    cursor = next
  }
  for (const preview of previews) {
    appendText(preview.textOffset)
    if (settledIds.has(preview.toolCallId) || preview.data.kind !== 'json_render') continue
    projected.push({ type: 'data', id: preview.toolCallId, dataType: 'overlay.generated_ui', data: preview.data,
      baseContent, renderedContent, transient: true, source: 'public-stream-preview', runId: stream.runId,
      executionGeneration: stream.executionGeneration, receiptId: stream.receiptId,
      invocation: stream.invocation, sequence: stream.sequence, toolCallId: preview.toolCallId,
      revision: stream.revision, order: preview.order, textOffset: preview.textOffset })
  }
  appendText(text.length)
  return projected
}

function shouldRetireStreamProjection(message: MessageWithParts, stream: ActivePublicStreamSnapshot): boolean {
  return Boolean(message.status && message.status !== 'generating')
    || checkpointSupersedesStream(message.publicStreamCheckpoint, stream)
}

function projectStreamMessage<T extends MessageWithParts>(
  message: T, stream: ActivePublicStreamSnapshot, priorPart: PublicStreamProjectionPart | undefined,
  baseContent: string, baseParts: readonly unknown[] | undefined,
): T {
  const text = [stream.text, stream.truncatedMarker ?? ''].filter(Boolean).join('\n\n')
  const previews = [...(stream.previews ?? [])].sort((a, b) => a.textOffset - b.textOffset || a.order - b.order)
  if (!text && !previews.length) return priorPart ? { ...message, content: baseContent, parts: baseParts } as T : message
  const projectionId = transcriptPartIdentity(stream.runId, stream.receiptId, 0, stream.executionGeneration)
  const continues = stream.continuesPrevious === true && Boolean(baseContent.trim()) && previews.length === 0
  const renderedContent = `${baseContent}${!baseContent.trim() || continues ? '' : '\n\n'}${text}`
  const settled = baseParts ?? []
  const insertAt = liveTextIndex(settled)
  const continuedPart = continues && isTextPart(settled[insertAt - 1]) ? settled[insertAt - 1] as { type: 'text'; text: string } : undefined
  const part = {
    type: 'text', id: continuedPart && 'id' in continuedPart && typeof continuedPart.id === 'string' ? continuedPart.id : projectionId,
    source: 'public-stream', runId: stream.runId, executionGeneration: stream.executionGeneration,
    receiptId: stream.receiptId, invocation: stream.invocation, sequence: stream.sequence, revision: stream.revision,
    text: continuedPart ? `${continuedPart.text}${text}` : text, baseContent, renderedContent,
    ...(continuedPart ? { continuedPart } : {}),
  }
  const before = settled.slice(0, continuedPart ? insertAt - 1 : insertAt)
  const projected = projectPreviewParts(settled, previews, part, projectionId, text, baseContent, renderedContent, stream)
  return { ...message, content: renderedContent, parts: [...before, ...projected, ...settled.slice(insertAt)] } as T
}

function projectMessage<T extends MessageWithParts>(message: T, stream: ActivePublicStreamSnapshot | undefined): T {
  const priorPart = message.parts?.find(isPublicStreamProjectionPart)
  const baseContent = getBaseContent(message, priorPart)
  const baseParts = getBaseParts(message, Boolean(priorPart))
  if (!(message._id ?? message.id)) return message
  if (!stream) return restoreRenderedProjection(message, priorPart, baseContent, baseParts)
  if (shouldRetireStreamProjection(message, stream)) return retireCheckpointedProjection(message, priorPart, baseContent, baseParts)
  if (priorProjectionIsNewer(priorPart, stream)) return message
  return projectStreamMessage(message, stream, priorPart, baseContent, baseParts)
}

function isValidStreamSnapshot(stream: ActivePublicStreamSnapshot): boolean {
  const previewsValid = (stream.previews ?? []).every(preview => Boolean(preview.toolCallId)
    && Number.isSafeInteger(preview.order) && preview.order >= 0
    && Number.isSafeInteger(preview.sequence) && preview.sequence >= 0
    && Number.isSafeInteger(preview.textOffset) && preview.textOffset >= 0
    && preview.data?.kind === 'json_render' && preview.data.streaming === true)
  const emptyTextRevision = stream.sequence === -1 && stream.text === '' && stream.truncatedMarker === undefined
    && Number.isSafeInteger(stream.revision) && (stream.revision ?? -1) >= 0
  return Boolean(stream.runId && stream.receiptId
    && Number.isSafeInteger(stream.executionGeneration) && stream.executionGeneration >= 0
    && Number.isSafeInteger(stream.invocation) && stream.invocation >= 0
    && Number.isSafeInteger(stream.sequence) && (stream.sequence >= 0 || emptyTextRevision)
    && previewsValid
    && (stream.revision === undefined || Number.isSafeInteger(stream.revision) && stream.revision >= 0))
}

export function projectActivePublicStreams<T extends MessageWithParts>(
  messages: readonly T[],
  streams: readonly ActivePublicStreamSnapshot[],
): T[] {
  const byMessageId = new Map(streams.filter(isValidStreamSnapshot)
    .sort((a, b) => a.executionGeneration - b.executionGeneration || a.invocation - b.invocation
      || (a.revision ?? a.sequence) - (b.revision ?? b.sequence) || a.sequence - b.sequence)
    .map(stream => [stream.assistantMessageId, stream]))
  return messages.map(message => projectMessage(message, byMessageId.get(message._id ?? message.id ?? '')))
}
