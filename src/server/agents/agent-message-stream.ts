import 'server-only'

import { logger } from '@/server/observability/logger'

/**
 * The slice of the collaboration repository a streaming agent turn needs. Kept
 * structural so the batching logic can be tested without a database.
 */
export type AgentMessageStreamStore = {
  startAgentMessage(args: {
    actorUserId: string
    authorPrincipalId: string
    clientNonce: string
    conversationId: string
    modelId: string
    threadRootMessageId?: string
    turnId: string
    workspaceId: string
  }): Promise<string>
  appendAgentMessageDelta(args: {
    actorUserId: string
    contentDelta: string
    conversationId: string
    emitEvent?: boolean
    messageId: string
    parts?: Array<Record<string, unknown>>
    workspaceId: string
  }): Promise<void>
  finalizeAgentMessage(args: {
    actorUserId: string
    content: string
    conversationId: string
    messageId: string
    parts?: Array<Record<string, unknown>>
    tokens?: { input: number; output: number }
    workspaceId: string
  }): Promise<void>
  failAgentMessage(args: {
    actorUserId: string
    conversationId: string
    content?: string
    messageId: string
    parts?: Array<Record<string, unknown>>
    workspaceId: string
  }): Promise<void>
}

/** A flush costs a write, so text accumulates until one of these trips. */
export const AGENT_STREAM_FLUSH_INTERVAL_MS = 250
export const AGENT_STREAM_FLUSH_CHARS = 200
/**
 * Durable `message.delta` events drive the polling (Postgres) transcript, where
 * each one costs every viewer a refetch. Convex subscribers re-render from the
 * row patch itself and do not wait for these, so they stay deliberately coarse.
 */
export const AGENT_STREAM_EVENT_INTERVAL_MS = 1_000

export type AgentMessageStream = ReturnType<typeof createAgentMessageStream>

/**
 * Persists a workspace-agent reply into a `generating` transcript row as it is
 * produced, so the reply belongs to the conversation rather than to whoever
 * happens to be holding a stream. Reloading, switching rooms, or watching from
 * another account all read the same row.
 *
 * The row is opened lazily on the first text so a turn that produces nothing
 * leaves no empty bubble behind, matching the non-streaming behaviour it
 * replaces. Every write is best-effort: if durable persistence is failing, the
 * turn still runs to completion and the caller falls back to a single terminal
 * write rather than losing the reply.
 */
export function createAgentMessageStream(args: {
  actorUserId: string
  authorPrincipalId: string
  clientNonce: string
  conversationId: string
  /**
   * A durable turn opens its row up front, together with the run record, so the
   * turn is visible and resumable before the model is called. Passing it here
   * skips the lazy open; the row is already there.
   */
  existingMessageId?: string
  modelId: string
  now?: () => number
  store: AgentMessageStreamStore
  threadRootMessageId?: string
  turnId: string
  workspaceId: string
}) {
  const now = args.now ?? Date.now
  let messageId: string | null = args.existingMessageId ?? null
  /** Set when persistence fails; the turn continues without durable rows. */
  let disabled = false
  let pendingText = ''
  let pendingParts: Array<Record<string, unknown>> | null = null
  let lastFlushAt = 0
  /** No event has been published yet, so the first flush must publish one. */
  let lastEventAt = Number.NEGATIVE_INFINITY
  /** Serializes writes so deltas cannot be appended out of order. */
  let queue: Promise<void> = Promise.resolve()

  const enqueue = (work: () => Promise<void>): Promise<void> => {
    queue = queue.then(work, work)
    return queue
  }

  const ensureRow = async (): Promise<string | null> => {
    if (disabled) return null
    if (messageId) return messageId
    try {
      messageId = await args.store.startAgentMessage({
        actorUserId: args.actorUserId,
        authorPrincipalId: args.authorPrincipalId,
        clientNonce: args.clientNonce,
        conversationId: args.conversationId,
        modelId: args.modelId,
        threadRootMessageId: args.threadRootMessageId,
        turnId: args.turnId,
        workspaceId: args.workspaceId,
      })
      return messageId
    } catch (error) {
      disabled = true
      logger.warn('[workspace-agent] could not open a durable reply row', {
        conversationId: args.conversationId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  const writePending = async (
    contentDelta: string,
    parts: Array<Record<string, unknown>> | null,
  ): Promise<void> => {
    if (!contentDelta && !parts) return
    const id = await ensureRow()
    if (!id) return
    const at = now()
    const emitEvent = at - lastEventAt >= AGENT_STREAM_EVENT_INTERVAL_MS
    try {
      await args.store.appendAgentMessageDelta({
        actorUserId: args.actorUserId,
        contentDelta,
        conversationId: args.conversationId,
        ...(emitEvent ? { emitEvent: true } : {}),
        messageId: id,
        ...(parts ? { parts } : {}),
        workspaceId: args.workspaceId,
      })
      lastFlushAt = at
      if (emitEvent) lastEventAt = at
    } catch (error) {
      // A dropped delta is recoverable: finalize rewrites the whole row with
      // the authoritative text, so the transcript still converges.
      logger.warn('[workspace-agent] delta append failed', {
        conversationId: args.conversationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const maybeFlush = (): void => {
    if (disabled) return
    const due = pendingText.length >= AGENT_STREAM_FLUSH_CHARS
      || pendingParts !== null
      || (pendingText.length > 0 && now() - lastFlushAt >= AGENT_STREAM_FLUSH_INTERVAL_MS)
    if (!due) return
    // Detached from the buffer before queueing, so a later finalize cannot
    // silently swallow a flush that was already committed to.
    const contentDelta = pendingText
    const parts = pendingParts
    pendingText = ''
    pendingParts = null
    void enqueue(() => writePending(contentDelta, parts))
  }

  return {
    get messageId() {
      return messageId
    },

    /** Buffers generated text; writes once a flush threshold trips. */
    pushText(delta: string): void {
      if (disabled || !delta) return
      pendingText += delta
      maybeFlush()
    },

    /**
     * Records a new parts snapshot. Tool calls and reasoning move at step
     * boundaries rather than per token, so a change here always flushes: it is
     * both rare and the most interesting thing a reader can see.
     */
    pushParts(parts: Array<Record<string, unknown>>): void {
      if (disabled) return
      pendingParts = parts
      maybeFlush()
    },

    /**
     * Writes the authoritative result. Returns the row id, or `null` when no
     * durable row exists and the caller must persist the reply itself.
     */
    async finalize(result: {
      content: string
      parts?: Array<Record<string, unknown>>
      tokens?: { input: number; output: number }
    }): Promise<string | null> {
      pendingText = ''
      pendingParts = null
      await enqueue(async () => {
        if (!messageId || disabled) return
        try {
          await args.store.finalizeAgentMessage({
            actorUserId: args.actorUserId,
            content: result.content,
            conversationId: args.conversationId,
            messageId,
            ...(result.parts ? { parts: result.parts } : {}),
            ...(result.tokens ? { tokens: result.tokens } : {}),
            workspaceId: args.workspaceId,
          })
        } catch (error) {
          disabled = true
          logger.error('[workspace-agent] could not finalize the durable reply row', {
            conversationId: args.conversationId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
      return disabled ? null : messageId
    },

    /**
     * Marks an opened row failed, keeping whatever text arrived. A truncated
     * reply the reader can see beats one that silently disappears.
     */
    async fail(result?: {
      content?: string
      parts?: Array<Record<string, unknown>>
    }): Promise<void> {
      pendingText = ''
      pendingParts = null
      await enqueue(async () => {
        if (!messageId || disabled) return
        try {
          await args.store.failAgentMessage({
            actorUserId: args.actorUserId,
            conversationId: args.conversationId,
            ...(result?.content === undefined ? {} : { content: result.content }),
            messageId,
            ...(result?.parts ? { parts: result.parts } : {}),
            workspaceId: args.workspaceId,
          })
        } catch (error) {
          logger.warn('[workspace-agent] could not mark the reply row failed', {
            conversationId: args.conversationId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    },
  }
}
