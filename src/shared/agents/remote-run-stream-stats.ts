/**
 * Per-run transport counters for connected-agent runs. They are recorded on `conversationAgentRuns.streamStats`
 * each time a host uploads an event batch, so QA and the smoke test can read how a run actually streamed:
 * how much was sent to show how much text (snapshot amplification), how often the assistant message was
 * rewritten, how far behind the host the server was, the longest silence, and the longest tool call.
 * See internal/plans/RELIABLE_CONNECTED_AGENTS_PLAN.md (Phase 0).
 */

export type RemoteRunStreamStats = {
  batches: number
  events: number
  /** Encoded size of every accepted event. */
  eventBytes: number
  /** Characters carried by `text_checkpoint` events; compare with the final text to see snapshot amplification. */
  textCheckpointChars: number
  textDeltaChars?: number
  /** Assistant-message rewrites caused by event batches. */
  messageWrites: number
  /** Batches the server refused (sequence gap, schema or size). */
  rejectedBatches: number
  firstEventAt?: number
  lastEventAt?: number
  /** Longest time between two accepted batches while the run was active. */
  maxQuietGapMs: number
  /** Longest delay between an event happening on the host and the server accepting it. */
  maxHostLagMs: number
  /** Longest finished tool call (action started → completed or failed). */
  longestToolMs: number
  longestToolTitle?: string
  /** Tool calls still running, so a later batch can time them. Bounded. */
  openTools: Array<{ actionId: string; title: string; startedAt: number }>
}

export const MAX_TRACKED_OPEN_TOOLS = 20

export function emptyRemoteRunStreamStats(): RemoteRunStreamStats {
  return {
    batches: 0, events: 0, eventBytes: 0, textCheckpointChars: 0, messageWrites: 0, rejectedBatches: 0,
    maxQuietGapMs: 0, maxHostLagMs: 0, longestToolMs: 0, openTools: [],
  }
}

type StreamEvent = { type: string; occurredAt: number; payload: Record<string, unknown> }

export function recordAcceptedBatch(
  previous: RemoteRunStreamStats | undefined,
  batch: { events: StreamEvent[]; bytes: number; now: number; wroteMessage: boolean },
): RemoteRunStreamStats {
  const stats = { ...emptyRemoteRunStreamStats(), ...previous }
  const open = new Map(stats.openTools.map((tool) => [tool.actionId, tool]))
  let { longestToolMs, longestToolTitle, maxHostLagMs, textCheckpointChars } = stats
  for (const event of batch.events) {
    maxHostLagMs = Math.max(maxHostLagMs, Math.max(0, batch.now - event.occurredAt))
    if (event.type === 'text_checkpoint' && typeof event.payload.text === 'string') {
      textCheckpointChars += event.payload.text.length
    }
    if (event.type !== 'action' || typeof event.payload.actionId !== 'string') continue
    const actionId = event.payload.actionId
    const title = typeof event.payload.title === 'string' ? event.payload.title.slice(0, 200) : 'Tool call'
    const status = event.payload.status
    if (status === 'completed' || status === 'failed') {
      const started = open.get(actionId)
      open.delete(actionId)
      if (started) {
        const duration = Math.max(0, event.occurredAt - started.startedAt)
        if (duration > longestToolMs) {
          longestToolMs = duration
          longestToolTitle = started.title
        }
      }
    } else if (!open.has(actionId)) {
      open.set(actionId, { actionId, title, startedAt: event.occurredAt })
    }
  }
  return {
    ...stats,
    batches: stats.batches + 1,
    events: stats.events + batch.events.length,
    eventBytes: stats.eventBytes + batch.bytes,
    textCheckpointChars,
    textDeltaChars: (stats.textDeltaChars ?? 0) + batch.events.reduce((sum, event) =>
      sum + (event.type === 'text_delta' && typeof event.payload.text === 'string' ? event.payload.text.length : 0), 0),
    messageWrites: stats.messageWrites + (batch.wroteMessage ? 1 : 0),
    firstEventAt: stats.firstEventAt ?? batch.now,
    lastEventAt: batch.now,
    maxQuietGapMs: stats.lastEventAt === undefined
      ? stats.maxQuietGapMs
      : Math.max(stats.maxQuietGapMs, batch.now - stats.lastEventAt),
    maxHostLagMs,
    longestToolMs,
    ...(longestToolTitle ? { longestToolTitle } : {}),
    // Keep the most recently started tools when a host leaves many open.
    openTools: [...open.values()].slice(-MAX_TRACKED_OPEN_TOOLS),
  }
}

export function recordRejectedBatch(previous: RemoteRunStreamStats | undefined): RemoteRunStreamStats {
  const stats = { ...emptyRemoteRunStreamStats(), ...previous }
  return { ...stats, rejectedBatches: stats.rejectedBatches + 1 }
}

/** What QA reads back: the stored counters plus the silence so far for a run that has not finished. */
export function summarizeRemoteRunStreamStats(stats: RemoteRunStreamStats | undefined, now: number, active: boolean) {
  const value = { ...emptyRemoteRunStreamStats(), ...stats }
  const currentQuietMs = active && value.lastEventAt !== undefined ? Math.max(0, now - value.lastEventAt) : 0
  const longestOpenTool = active
    ? value.openTools.reduce<{ title: string; runningMs: number } | undefined>((longest, tool) => {
      const runningMs = Math.max(0, now - tool.startedAt)
      return !longest || runningMs > longest.runningMs ? { title: tool.title, runningMs } : longest
    }, undefined)
    : undefined
  return {
    batches: value.batches,
    events: value.events,
    eventBytes: value.eventBytes,
    textCheckpointChars: value.textCheckpointChars,
    textDeltaChars: value.textDeltaChars ?? 0,
    messageWrites: value.messageWrites,
    rejectedBatches: value.rejectedBatches,
    maxQuietGapMs: Math.max(value.maxQuietGapMs, currentQuietMs),
    currentQuietMs,
    maxHostLagMs: value.maxHostLagMs,
    longestToolMs: Math.max(value.longestToolMs, longestOpenTool?.runningMs ?? 0),
    longestToolTitle: (longestOpenTool && longestOpenTool.runningMs > value.longestToolMs ? longestOpenTool.title : value.longestToolTitle) ?? null,
    openTools: active ? value.openTools.length : 0,
    firstEventAt: value.firstEventAt ?? null,
    lastEventAt: value.lastEventAt ?? null,
  }
}
