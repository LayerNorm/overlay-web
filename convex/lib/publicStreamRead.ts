import { v } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

const TRUNCATION_MARKER = '[Additional output omitted]'

/**
 * Whether the streaming call continues text that the previous settled call stopped
 * mid-output (it reached its output-token cap), so the reader joins it without a gap.
 */
async function continuesSettledOutput(
  ctx: MutationCtx | QueryCtx,
  stream: { runId: string; receiptId: string },
): Promise<boolean> {
  const sequence = /^model:(\d+)$/.exec(stream.receiptId)?.[1]
  if (sequence === undefined) return false
  const rows = await ctx.db.query('harnessTranscriptSteps')
    .withIndex('by_runId_sequence', q => q.eq('runId', stream.runId).lt('sequence', Number(sequence)))
    .order('desc').take(10)
  for (const row of rows) {
    if (row.hasOutput !== undefined) {
      if (row.hasOutput) return row.outputLimitReached === true
      continue
    }
    let step: { content?: unknown; parts?: unknown; outputLimitReached?: unknown }
    try { step = JSON.parse(row.persistenceJson) as typeof step } catch { return false }
    if (transcriptStepHasOutput(step)) return step.outputLimitReached === true
  }
  return false
}

/** Whether a settled step wrote anything, stored on the step row so readers skip its JSON. */
export function transcriptStepHasOutput(step: { content?: unknown; parts?: unknown }): boolean {
  return Boolean(step.content) || (Array.isArray(step.parts) && step.parts.length > 0)
}

async function readStreamContent(
  ctx: MutationCtx | QueryCtx,
  stream: { runId: string; workflowRunId: string; executionGeneration: number; receiptId: string },
): Promise<{ text: string; truncated: boolean }> {
  const segments = await ctx.db.query('harnessPublicStreamSegments')
    .withIndex('by_runId_receiptId_segmentIndex', q =>
      q.eq('runId', stream.runId).eq('receiptId', stream.receiptId))
    .order('asc').take(100)
  const activeSegments = segments.filter(segment => segment.workflowRunId === stream.workflowRunId
    && segment.executionGeneration === stream.executionGeneration && segment.receiptId === stream.receiptId)
  return {
    text: activeSegments.map(segment => segment.text).join(''),
    truncated: activeSegments.some(segment => Boolean(segment.truncatedMarker)),
  }
}

export async function cleanupTerminalPublicStreams(
  ctx: MutationCtx,
  assistantMessageId: Id<'conversationMessages'>,
): Promise<void> {
  const message = await ctx.db.get(assistantMessageId)
  if (!message || message.status === 'generating') return
  const streams = await ctx.db.query('harnessPublicStreams')
    .withIndex('by_conversation_assistantMessageId', q =>
      q.eq('conversationId', message.conversationId).eq('assistantMessageId', assistantMessageId))
    .take(10)
  for (const stream of streams) {
    const segments = await ctx.db.query('harnessPublicStreamSegments')
      .withIndex('by_runId', q => q.eq('runId', stream.runId)).take(100)
    for (const segment of segments) await ctx.db.delete(segment._id)
    await ctx.db.delete(stream._id)
  }
}

type ActiveStreamRow = Doc<'harnessPublicStreams'>

/**
 * The newest stream row a viewer may read for this reply, after the per-viewer and
 * retry/generation checks. Callers have already authorized the conversation itself.
 */
async function readableActiveStream(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<'conversations'>,
  assistantMessageId: Id<'conversationMessages'>,
): Promise<ActiveStreamRow | null> {
  const stream = await ctx.db.query('harnessPublicStreams')
    .withIndex('by_conversation_assistantMessageId', q => q.eq('conversationId', conversationId).eq('assistantMessageId', assistantMessageId))
    .unique()
  if (!stream || !stream.active || stream.conversationId !== conversationId) return null
  const message = await ctx.db.get(assistantMessageId)
  if (!message || message.deletedAt !== undefined || message.conversationId !== conversationId || message.status !== 'generating') return null
  const run = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', stream.runId)).unique()
  if (!run || run.actorUserId !== message.userId || run.rootRunId !== run.runId || run.parentRunId) return null
  let metadata: {
    workflowRunId?: string
    executionGeneration?: number
    policy?: { publicStreamVersion?: number }
  }
  try { metadata = JSON.parse(run.metadataJson) as typeof metadata } catch { return null }
  if (metadata.policy?.publicStreamVersion !== 1
    || metadata.workflowRunId !== stream.workflowRunId
    || (metadata.executionGeneration ?? 0) !== stream.executionGeneration) return null
  const deliveryId = run.deliveryAgentRunId
    ? ctx.db.normalizeId('conversationAgentRuns', run.deliveryAgentRunId) : null
  const delivery = deliveryId ? await ctx.db.get(deliveryId) : null
  if (!delivery || delivery.userId !== run.actorUserId
    || delivery.harnessRunId !== run.runId
    || delivery.workflowRunId !== stream.workflowRunId || delivery.conversationId !== conversationId
    || delivery.assistantMessageId !== message._id || delivery.turnId !== message.turnId
    || delivery.executionEngine !== 'overlay_harness' || delivery.runner !== 'workflow') return null
  const checkpoint = message.publicStreamCheckpoint
  if (checkpoint && (checkpoint.executionGeneration > stream.executionGeneration
    || (checkpoint.executionGeneration === stream.executionGeneration
      && checkpoint.invocation >= stream.invocation))) return null
  const conversation = await ctx.db.get(conversationId)
  if (!conversation || conversation.deletedAt !== undefined) return null
  if (delivery.mode === 'room' || delivery.mode === 'work') {
    if (!delivery.agentPrincipalId || message.authorKind !== 'agent'
      || message.authorPrincipalId !== delivery.agentPrincipalId) return null
  } else if (conversation.userId !== run.actorUserId || message.userId !== run.actorUserId
    || message.authorKind === 'agent' || message.authorPrincipalId !== undefined) return null
  return stream
}

export async function readActivePublicStreams(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<'conversations'>,
  requestedMessageIds: Id<'conversationMessages'>[],
) {
  if (requestedMessageIds.length > 50) throw new Error('Too many active message IDs.')
  const messageIds = [...new Set(requestedMessageIds)]
  const output = []
  for (const assistantMessageId of messageIds) {
    const stream = await readableActiveStream(ctx, conversationId, assistantMessageId)
    if (!stream) continue
    const { text, truncated } = await readStreamContent(ctx, stream)
    if (!text && !truncated) continue
    output.push({
      assistantMessageId, runId: stream.runId, executionGeneration: stream.executionGeneration,
      receiptId: stream.receiptId, invocation: stream.invocation, sequence: stream.nextSequence - 1, text,
      truncatedMarker: truncated ? TRUNCATION_MARKER : undefined,
      ...(await continuesSettledOutput(ctx, stream) ? { continuesPrevious: true as const } : {}),
    })
  }
  return output
}

/** What a reader already holds for one reply's live stream. */
export type PublicStreamCursor = {
  assistantMessageId: Id<'conversationMessages'>
  runId: string
  executionGeneration: number
  invocation: number
  /**
   * Ignored. Readers no longer send it: a cursor that changed on every update made each update a new
   * subscription. Kept optional so an older client's read still validates.
   */
  sequence?: number
  /** The last segment the reader holds; it can still grow, so it is sent again when it does. */
  segmentIndex: number
}

export const publicStreamCursorValidator = v.object({
  assistantMessageId: v.id('conversationMessages'),
  runId: v.string(),
  executionGeneration: v.number(),
  invocation: v.number(),
  sequence: v.optional(v.number()),
  segmentIndex: v.number(),
})

/**
 * Incremental live text: with a matching cursor, the segments from the reader's last (still
 * growing) segment onward; without one, every segment from the first. The cursor only moves
 * when a new segment starts, so while a segment grows the reader keeps one reactive
 * subscription and each re-run reads that one segment. The same per-viewer and generation
 * checks apply.
 */
export async function readActivePublicStreamUpdates(
  ctx: QueryCtx,
  conversationId: Id<'conversations'>,
  requestedMessageIds: Id<'conversationMessages'>[],
  cursors: PublicStreamCursor[],
) {
  if (requestedMessageIds.length > 50 || cursors.length > 50) throw new Error('Too many active message IDs.')
  const held = new Map(cursors.map(cursor => [cursor.assistantMessageId, cursor]))
  const output = []
  for (const assistantMessageId of [...new Set(requestedMessageIds)]) {
    const stream = await readableActiveStream(ctx, conversationId, assistantMessageId)
    if (!stream) continue
    const sequence = stream.nextSequence - 1
    const cursor = held.get(assistantMessageId)
    const sameStream = cursor !== undefined && cursor.runId === stream.runId
      && cursor.executionGeneration === stream.executionGeneration && cursor.invocation === stream.invocation
      && Number.isSafeInteger(cursor.segmentIndex) && cursor.segmentIndex >= 0
    const fromSegmentIndex = sameStream ? cursor.segmentIndex : 0
    const segments = (await ctx.db.query('harnessPublicStreamSegments')
      .withIndex('by_runId_receiptId_segmentIndex', q =>
        q.eq('runId', stream.runId).eq('receiptId', stream.receiptId).gte('segmentIndex', fromSegmentIndex))
      .order('asc').take(100))
      .filter(segment => segment.workflowRunId === stream.workflowRunId
        && segment.executionGeneration === stream.executionGeneration)
    if (!sameStream && !stream.truncated && !segments.some(segment => segment.text)) continue
    output.push({
      assistantMessageId, runId: stream.runId, executionGeneration: stream.executionGeneration,
      receiptId: stream.receiptId, invocation: stream.invocation, sequence,
      fromSegmentIndex,
      segments: segments.map(segment => ({ index: segment.segmentIndex, text: segment.text })),
      truncatedMarker: stream.truncated ? TRUNCATION_MARKER : undefined,
      ...(await continuesSettledOutput(ctx, stream) ? { continuesPrevious: true as const } : {}),
    })
  }
  return output
}

/**
 * The live text a cancelled delivery left behind, for the deferred cancellation step only.
 * It skips the reader-side liveness checks on purpose: cancellation has already retired the
 * run, so those checks would hide exactly the text that must be kept. Text a settled
 * checkpoint already covers is not returned again.
 */
export async function readRetainedPublicStream(
  ctx: MutationCtx,
  conversationId: Id<'conversations'>,
  assistantMessageId: Id<'conversationMessages'>,
) {
  const message = await ctx.db.get(assistantMessageId)
  if (!message || message.conversationId !== conversationId) return null
  const stream = await ctx.db.query('harnessPublicStreams')
    .withIndex('by_conversation_assistantMessageId', q => q.eq('conversationId', conversationId).eq('assistantMessageId', assistantMessageId))
    .unique()
  if (!stream || !stream.active) return null
  const checkpoint = message.publicStreamCheckpoint
  if (checkpoint && checkpoint.runId === stream.runId
    && (checkpoint.executionGeneration > stream.executionGeneration
      || (checkpoint.executionGeneration === stream.executionGeneration && checkpoint.invocation >= stream.invocation))) return null
  const { text, truncated } = await readStreamContent(ctx, stream)
  if (!text && !truncated) return null
  return {
    runId: stream.runId, executionGeneration: stream.executionGeneration, receiptId: stream.receiptId,
    invocation: stream.invocation, text, truncatedMarker: truncated ? TRUNCATION_MARKER : undefined,
    ...(await continuesSettledOutput(ctx, stream) ? { continuesPrevious: true as const } : {}),
  }
}
