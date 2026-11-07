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
    const content = await readStreamContent(ctx, stream)
    if ((content.text && !message.content.includes(content.text))
      || (content.truncated && !message.content.includes(TRUNCATION_MARKER))) continue
    const segments = await ctx.db.query('harnessPublicStreamSegments')
      .withIndex('by_runId', q => q.eq('runId', stream.runId)).take(100)
    for (const segment of segments) await ctx.db.delete(segment._id)
    await ctx.db.delete(stream._id)
  }
}

export async function readActivePublicStreams(
  ctx: QueryCtx,
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
    if (!message || message.conversationId !== conversationId) continue
    const { text, truncated } = await readStreamContent(ctx, stream)
    if (!text && !truncated) continue
    if (text && message.content.includes(text)
      && (!truncated || message.content.includes(TRUNCATION_MARKER))) continue
    output.push({
      assistantMessageId, runId: stream.runId, executionGeneration: stream.executionGeneration,
      receiptId: stream.receiptId, sequence: stream.nextSequence - 1, text,
      truncatedMarker: truncated ? TRUNCATION_MARKER : undefined,
    })
  }
  return output
}
