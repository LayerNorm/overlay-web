import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

const TRUNCATION_MARKER = '[Additional output omitted]'

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

export async function readActivePublicStreams(
  ctx: QueryCtx | MutationCtx,
  conversationId: Id<'conversations'>,
  requestedMessageIds: Id<'conversationMessages'>[],
) {
  if (requestedMessageIds.length > 50) throw new Error('Too many active message IDs.')
  const messageIds = [...new Set(requestedMessageIds)]
  const output = []
  for (const assistantMessageId of messageIds) {
    const stream = await ctx.db.query('harnessPublicStreams')
      .withIndex('by_conversation_assistantMessageId', q => q.eq('conversationId', conversationId).eq('assistantMessageId', assistantMessageId))
      .unique()
    if (!stream || !stream.active || stream.conversationId !== conversationId) continue
    const message = await ctx.db.get(assistantMessageId)
    if (!message || message.deletedAt !== undefined || message.conversationId !== conversationId || message.status !== 'generating') continue
    const run = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', stream.runId)).unique()
    if (!run || run.actorUserId !== message.userId || run.rootRunId !== run.runId || run.parentRunId) continue
    let metadata: {
      status?: string
      workflowRunId?: string
      executionGeneration?: number
      modelReservation?: { id?: string; dispatch?: { modelId?: string } }
      policy?: { publicStreamVersion?: number }
    }
    try { metadata = JSON.parse(run.metadataJson) as typeof metadata } catch { continue }
    if (metadata.policy?.publicStreamVersion !== 1
      || metadata.workflowRunId !== stream.workflowRunId
      || (metadata.executionGeneration ?? 0) !== stream.executionGeneration) continue
    const deliveryId = run.deliveryAgentRunId
      ? ctx.db.normalizeId('conversationAgentRuns', run.deliveryAgentRunId) : null
    const delivery = deliveryId ? await ctx.db.get(deliveryId) : null
    if (!delivery || delivery.userId !== run.actorUserId
      || delivery.harnessRunId !== run.runId
      || delivery.workflowRunId !== stream.workflowRunId || delivery.conversationId !== conversationId
      || delivery.assistantMessageId !== message._id || delivery.turnId !== message.turnId
      || delivery.executionEngine !== 'overlay_harness' || delivery.runner !== 'workflow') continue
    const checkpoint = message.publicStreamCheckpoint
    if (checkpoint && (checkpoint.executionGeneration > stream.executionGeneration
      || (checkpoint.executionGeneration === stream.executionGeneration
        && checkpoint.invocation >= stream.invocation))) continue
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.deletedAt !== undefined) continue
    if (delivery.mode === 'room' || delivery.mode === 'work') {
      if (!delivery.agentPrincipalId || message.authorKind !== 'agent'
        || message.authorPrincipalId !== delivery.agentPrincipalId) continue
    } else if (conversation.userId !== run.actorUserId || message.userId !== run.actorUserId
      || message.authorKind === 'agent' || message.authorPrincipalId !== undefined) continue
    const { text, truncated } = await readStreamContent(ctx, stream)
    if (!text && !truncated) continue
    output.push({
      assistantMessageId, runId: stream.runId, executionGeneration: stream.executionGeneration,
      receiptId: stream.receiptId, invocation: stream.invocation, sequence: stream.nextSequence - 1, text,
      truncatedMarker: truncated ? TRUNCATION_MARKER : undefined,
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
  }
}
