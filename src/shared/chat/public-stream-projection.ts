import { transcriptPartIdentity } from './transcript-part-identity'

export type ActivePublicStreamSnapshot = {
  assistantMessageId: string
  runId: string
  executionGeneration: number
  receiptId: string
  sequence: number
  text: string
  truncatedMarker?: string
  status?: string
}

type MessageWithParts = {
  _id: string
  content: string
  parts?: readonly unknown[]
}

export function projectActivePublicStreams<T extends MessageWithParts>(
  messages: readonly T[],
  streams: readonly ActivePublicStreamSnapshot[],
): T[] {
  const byMessageId = new Map(streams.filter(stream => stream.runId && stream.receiptId
    && Number.isSafeInteger(stream.executionGeneration) && stream.executionGeneration >= 0
    && Number.isSafeInteger(stream.sequence) && stream.sequence >= 0)
    .map(stream => [stream.assistantMessageId, stream]))
  return messages.map(message => {
    const priorPart = message.parts?.find(part => part && typeof part === 'object'
      && 'source' in part && (part as { source?: unknown }).source === 'public-stream') as
      | { text?: unknown; sequence?: unknown; runId?: unknown; executionGeneration?: unknown; receiptId?: unknown }
      | undefined
    let baseContent = message.content
    if (priorPart && typeof priorPart.text === 'string') {
      const priorText = priorPart.text
      const suffix = `\n\n${priorText}`
      if (baseContent.endsWith(suffix)) baseContent = baseContent.slice(0, -suffix.length)
    }
    const baseParts = priorPart
      ? message.parts?.filter(part => !part || typeof part !== 'object'
        || !('source' in part) || (part as { source?: unknown }).source !== 'public-stream')
      : message.parts
    const stream = byMessageId.get(message._id)
    if (!stream) {
      return priorPart ? { ...message, content: baseContent, parts: baseParts } as T : message
    }
    if (priorPart && priorPart.runId === stream.runId
      && priorPart.executionGeneration === stream.executionGeneration
      && priorPart.receiptId === stream.receiptId
      && typeof priorPart.sequence === 'number' && stream.sequence < priorPart.sequence) return message
    const hasCanonicalText = Boolean(stream.text && baseContent.includes(stream.text))
    const hasCanonicalMarker = Boolean(stream.truncatedMarker && baseContent.includes(stream.truncatedMarker))
    if ((!stream.text || hasCanonicalText) && (!stream.truncatedMarker || hasCanonicalMarker)) {
      return priorPart ? { ...message, content: baseContent, parts: baseParts } as T : message
    }
    const visibleText = hasCanonicalText ? '' : stream.text
    const markerText = stream.truncatedMarker && !hasCanonicalMarker ? stream.truncatedMarker : ''
    const text = [visibleText, markerText].filter(Boolean).join('\n\n')
    if (!text) return priorPart ? { ...message, content: baseContent, parts: baseParts } as T : message
    const projectionId = transcriptPartIdentity(stream.runId, stream.receiptId, 'public-stream', stream.executionGeneration)
    const separator = baseContent.trim() ? '\n\n' : ''
    const part = {
      type: 'text',
      id: projectionId,
      source: 'public-stream',
      runId: stream.runId,
      executionGeneration: stream.executionGeneration,
      receiptId: stream.receiptId,
      sequence: stream.sequence,
      text,
    }
    return {
      ...message,
      content: `${baseContent}${separator}${text}`,
      parts: [...(baseParts ?? []), part],
    } as T
  })
}
