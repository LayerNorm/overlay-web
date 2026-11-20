import type { ActivePublicStreamSnapshot } from './public-stream-projection'

/** One reply's incremental live-text result from `activePublicStreamUpdates`. */
export type PublicStreamUpdate = {
  assistantMessageId: string
  runId: string
  executionGeneration: number
  receiptId: string
  invocation: number
  sequence: number
  /** The first segment index this result carries; earlier segments are unchanged. */
  fromSegmentIndex: number
  segments: ReadonlyArray<{ index: number; text: string }>
  truncatedMarker?: string
  continuesPrevious?: boolean
}

/** The live text a reader holds for one reply, segment by segment. */
export type HeldPublicStream = {
  assistantMessageId: string
  runId: string
  executionGeneration: number
  receiptId: string
  invocation: number
  sequence: number
  segments: readonly string[]
  truncatedMarker?: string
  continuesPrevious?: boolean
  /** The segments could not be joined in order; the next read starts from the first segment. */
  resync?: boolean
  snapshot: ActivePublicStreamSnapshot
}

export type PublicStreamCursor = {
  assistantMessageId: string
  runId: string
  executionGeneration: number
  invocation: number
  segmentIndex: number
}

type StreamIdentity = Pick<HeldPublicStream, 'runId' | 'executionGeneration' | 'receiptId' | 'invocation'>

function sameStream(a: StreamIdentity, b: StreamIdentity) {
  return a.runId === b.runId && a.executionGeneration === b.executionGeneration
    && a.receiptId === b.receiptId && a.invocation === b.invocation
}

function toHeld(update: PublicStreamUpdate, segments: readonly string[], resync: boolean): HeldPublicStream {
  const optional = {
    ...(update.truncatedMarker ? { truncatedMarker: update.truncatedMarker } : {}),
    ...(update.continuesPrevious ? { continuesPrevious: true } : {}),
  }
  return {
    assistantMessageId: update.assistantMessageId,
    runId: update.runId,
    executionGeneration: update.executionGeneration,
    receiptId: update.receiptId,
    invocation: update.invocation,
    sequence: update.sequence,
    segments,
    ...optional,
    ...(resync ? { resync: true } : {}),
    snapshot: {
      assistantMessageId: update.assistantMessageId,
      runId: update.runId,
      executionGeneration: update.executionGeneration,
      receiptId: update.receiptId,
      invocation: update.invocation,
      sequence: update.sequence,
      text: segments.join(''),
      ...optional,
    },
  }
}

function mergeOne(prior: HeldPublicStream | undefined, update: PublicStreamUpdate): HeldPublicStream {
  const continues = prior !== undefined && !prior.resync && sameStream(prior, update)
  if (continues && update.sequence < prior.sequence) return prior
  if (continues ? update.fromSegmentIndex > prior.segments.length : update.fromSegmentIndex !== 0) {
    // A gap: keep what is on screen and read the whole stream again.
    return prior && sameStream(prior, update) ? { ...prior, resync: true } : toHeld(update, [], true)
  }
  // A re-read that returns the segments already held (same sequence, same text) keeps the held value.
  if (continues && update.sequence === prior.sequence
    && update.segments.every((segment) => prior.segments[segment.index] === segment.text)
    && update.fromSegmentIndex + update.segments.length >= prior.segments.length
    && prior.truncatedMarker === update.truncatedMarker
    && Boolean(prior.continuesPrevious) === Boolean(update.continuesPrevious)) return prior
  const segments = continues ? prior.segments.slice(0, update.fromSegmentIndex) : []
  const from = segments.length
  let ordered = true
  for (const segment of update.segments) {
    if (segment.index !== segments.length) ordered = false
    segments.push(segment.text)
  }
  return toHeld(update, segments, !ordered && from > 0)
}

/**
 * Applies one incremental read. Replies missing from the read are no longer live and
 * are dropped. Unchanged replies keep their identity, and an unchanged read returns
 * the same map, so a re-read that brought nothing new does not re-render the transcript.
 */
export function mergePublicStreamUpdates(
  current: ReadonlyMap<string, HeldPublicStream>,
  updates: readonly PublicStreamUpdate[],
): ReadonlyMap<string, HeldPublicStream> {
  const next = new Map<string, HeldPublicStream>()
  for (const update of updates) {
    next.set(update.assistantMessageId, mergeOne(current.get(update.assistantMessageId), update))
  }
  if (next.size === current.size && [...next].every(([id, value]) => current.get(id) === value)) return current
  return next
}

/** What to send so the next read returns only text this reader does not hold. */
export function publicStreamCursors(
  current: ReadonlyMap<string, HeldPublicStream>,
  messageIds: readonly string[],
): PublicStreamCursor[] {
  return messageIds.flatMap((id) => {
    const stream = current.get(id)
    if (!stream || stream.resync) return []
    return [{
      assistantMessageId: stream.assistantMessageId,
      runId: stream.runId,
      executionGeneration: stream.executionGeneration,
      invocation: stream.invocation,
      segmentIndex: Math.max(0, stream.segments.length - 1),
    }]
  })
}
