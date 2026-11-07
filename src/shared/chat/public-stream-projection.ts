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
}
export type PublicStreamCheckpoint = Pick<ActivePublicStreamSnapshot, 'runId' | 'executionGeneration' | 'receiptId' | 'invocation'>

type MessageWithParts = {
  _id: string
  content: string
  parts?: readonly unknown[]
  status?: string
  publicStreamCheckpoint?: PublicStreamCheckpoint
}

export function projectActivePublicStreams<T extends MessageWithParts>(
  messages: readonly T[],
  streams: readonly ActivePublicStreamSnapshot[],
): T[] {
  const byMessageId = new Map(streams.filter(stream => stream.runId && stream.receiptId
    && Number.isSafeInteger(stream.executionGeneration) && stream.executionGeneration >= 0
    && Number.isSafeInteger(stream.invocation) && stream.invocation >= 0
    && Number.isSafeInteger(stream.sequence) && stream.sequence >= 0)
    .sort((a, b) => a.executionGeneration - b.executionGeneration || a.invocation - b.invocation || a.sequence - b.sequence)
    .map(stream => [stream.assistantMessageId, stream]))
  return messages.map(message => {
    const priorPart = message.parts?.find(part => part && typeof part === 'object'
      && 'source' in part && (part as { source?: unknown }).source === 'public-stream') as
      | { text?: unknown; sequence?: unknown; invocation?: unknown; runId?: unknown; executionGeneration?: unknown; receiptId?: unknown; renderedContent?: unknown; baseContent?: unknown }
      | undefined
    let baseContent = message.content
    if (priorPart && typeof priorPart.renderedContent === 'string'
      && message.content === priorPart.renderedContent && typeof priorPart.baseContent === 'string') {
      baseContent = priorPart.baseContent
    }
    const baseParts = priorPart
      ? message.parts?.filter(part => !part || typeof part !== 'object'
        || !('source' in part) || (part as { source?: unknown }).source !== 'public-stream')
      : message.parts
    const stream = byMessageId.get(message._id)
    if (!stream) {
      return priorPart && message.content === priorPart.renderedContent
        ? { ...message, content: baseContent, parts: baseParts } as T : message
    }
    const checkpoint = message.publicStreamCheckpoint
    const checkpointMatches = checkpoint?.runId === stream.runId
      && checkpoint.executionGeneration === stream.executionGeneration
      && checkpoint.receiptId === stream.receiptId && checkpoint.invocation === stream.invocation
    const checkpointIsNewer = checkpoint && (checkpoint.executionGeneration > stream.executionGeneration
      || (checkpoint.executionGeneration === stream.executionGeneration && checkpoint.invocation > stream.invocation))
    if ((message.status && message.status !== 'generating') || checkpointMatches || checkpointIsNewer) {
      return priorPart && message.content === priorPart.renderedContent
        ? { ...message, content: baseContent, parts: baseParts } as T
        : priorPart ? { ...message, parts: baseParts } as T : message
    }
    if (priorPart && priorPart.runId === stream.runId
      && typeof priorPart.executionGeneration === 'number'
      && (priorPart.executionGeneration > stream.executionGeneration
        || (priorPart.executionGeneration === stream.executionGeneration
          && typeof priorPart.invocation === 'number'
          && (priorPart.invocation > stream.invocation
            || (priorPart.invocation === stream.invocation
              && typeof priorPart.sequence === 'number' && priorPart.sequence > stream.sequence))))) return message
    const visibleText = stream.text
    const markerText = stream.truncatedMarker ?? ''
    const text = [visibleText, markerText].filter(Boolean).join('\n\n')
    if (!text) return priorPart ? { ...message, content: baseContent, parts: baseParts } as T : message
    const projectionId = transcriptPartIdentity(stream.runId, stream.receiptId, 0, stream.executionGeneration)
    const separator = baseContent.trim() ? '\n\n' : ''
    const renderedContent = `${baseContent}${separator}${text}`
    const part = {
      type: 'text',
      id: projectionId,
      source: 'public-stream',
      runId: stream.runId,
      executionGeneration: stream.executionGeneration,
      receiptId: stream.receiptId,
      invocation: stream.invocation,
      sequence: stream.sequence,
      text,
      baseContent,
      renderedContent,
    }
    return {
      ...message,
      content: renderedContent,
      parts: [...(baseParts ?? []), part],
    } as T
  })
}
