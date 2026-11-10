import { transcriptPartIdentity } from './transcript-part-identity'

export type ActivePublicStreamSnapshot = {
  assistantMessageId: string
  runId: string
  executionGeneration: number
  receiptId: string
  invocation: number
  sequence: number
  text: string
  truncatedMarker?: string
  status?: string
  /** The streaming call continues text the previous call stopped mid-output. */
  continuesPrevious?: boolean
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
  renderedContent?: unknown
  baseContent?: unknown
  /** The base text part this projection extended in place, restored when it retires. */
  continuedPart?: unknown
}

function isPublicStreamProjectionPart(part: unknown): part is PublicStreamProjectionPart {
  return Boolean(part && typeof part === 'object'
    && 'source' in part && (part as { source?: unknown }).source === 'public-stream')
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
  return priorPart && message.content === priorPart.renderedContent
    ? { ...message, content: baseContent, parts: baseParts } as T
    : message
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

function projectMessage<T extends MessageWithParts>(
  message: T,
  stream: ActivePublicStreamSnapshot | undefined,
): T {
  const priorPart = message.parts?.find(isPublicStreamProjectionPart)
  const baseContent = getBaseContent(message, priorPart)
  const baseParts = getBaseParts(message, Boolean(priorPart))
  if (!(message._id ?? message.id)) return message
  if (!stream) return restoreRenderedProjection(message, priorPart, baseContent, baseParts)
  if ((message.status && message.status !== 'generating')
    || checkpointSupersedesStream(message.publicStreamCheckpoint, stream)) {
    return retireCheckpointedProjection(message, priorPart, baseContent, baseParts)
  }
  if (priorProjectionIsNewer(priorPart, stream)) return message
  const text = [stream.text, stream.truncatedMarker ?? ''].filter(Boolean).join('\n\n')
  if (!text) {
    return priorPart ? { ...message, content: baseContent, parts: baseParts } as T : message
  }
  const projectionId = transcriptPartIdentity(stream.runId, stream.receiptId, 0, stream.executionGeneration)
  const continues = stream.continuesPrevious === true && Boolean(baseContent.trim())
  const separator = !baseContent.trim() || continues ? '' : '\n\n'
  const renderedContent = `${baseContent}${separator}${text}`
  const settled = baseParts ?? []
  const insertAt = liveTextIndex(settled)
  // Continued text extends the last text block, so a cut-off Markdown list stays one list.
  const continuedPart = continues && isTextPart(settled[insertAt - 1]) ? settled[insertAt - 1] as { type: 'text'; text: string } : undefined
  const part = {
    type: 'text',
    id: continuedPart && 'id' in continuedPart && typeof continuedPart.id === 'string' ? continuedPart.id : projectionId,
    source: 'public-stream',
    runId: stream.runId,
    executionGeneration: stream.executionGeneration,
    receiptId: stream.receiptId,
    invocation: stream.invocation,
    sequence: stream.sequence,
    text: continuedPart ? `${continuedPart.text}${text}` : text,
    baseContent,
    renderedContent,
    ...(continuedPart ? { continuedPart } : {}),
  }
  const before = settled.slice(0, continuedPart ? insertAt - 1 : insertAt)
  const parts = [...before, part, ...settled.slice(insertAt)]
  return { ...message, content: renderedContent, parts } as T
}

function isValidStreamSnapshot(stream: ActivePublicStreamSnapshot): boolean {
  return Boolean(stream.runId && stream.receiptId
    && Number.isSafeInteger(stream.executionGeneration) && stream.executionGeneration >= 0
    && Number.isSafeInteger(stream.invocation) && stream.invocation >= 0
    && Number.isSafeInteger(stream.sequence) && stream.sequence >= 0)
}

export function projectActivePublicStreams<T extends MessageWithParts>(
  messages: readonly T[],
  streams: readonly ActivePublicStreamSnapshot[],
): T[] {
  const byMessageId = new Map(streams.filter(isValidStreamSnapshot)
    .sort((a, b) => a.executionGeneration - b.executionGeneration || a.invocation - b.invocation || a.sequence - b.sequence)
    .map(stream => [stream.assistantMessageId, stream]))
  return messages.map(message => projectMessage(message, byMessageId.get(message._id ?? message.id ?? '')))
}
