import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'

export async function assignmentCompletionIssues(ctx: Pick<QueryCtx, 'db'>, parentRunId: string) {
  const attempts = await ctx.db.query('agentAssignmentAttempts').withIndex('by_parentRunId', q => q.eq('parentRunId', parentRunId)).collect()
  const issues: string[] = []
  for (const attempt of attempts) {
    const assignment = await ctx.db.query('agentAssignments').withIndex('by_assignmentId', q => q.eq('assignmentId', attempt.assignmentId)).unique()
    if (assignment?.currentAttemptId !== attempt.attemptId) continue
    if (attempt.cancelledAt !== undefined && !attempt.childRunId) continue
    if (attempt.disposition === 'excluded' && attempt.dispositionReason?.trim()) continue
    const result = await ctx.db.query('agentAssignmentResults').withIndex('by_attemptId', q => q.eq('attemptId', attempt.attemptId)).unique()
    if (attempt.disposition === 'accepted' && result?.terminal && !result.publicationPending && result.runStatus === 'completed') continue
    issues.push(`${attempt.assignmentId} (${attempt.attemptId}): ${result?.runStatus ?? 'queued'}${result?.publicationPending ? ', publication pending' : ''}; read the result, then accept, revise, or exclude with a reason.`)
  }
  return issues
}

export async function cancelPendingAssignmentLaunches(ctx: MutationCtx, parentRunId: string) {
  const intents = await ctx.db.query('agentAssignmentLaunchIntents').withIndex('by_parentRunId', q => q.eq('parentRunId', parentRunId)).collect()
  for (const intent of intents) {
    if (intent.state !== 'pending') continue
    await ctx.db.patch(intent._id, { state: 'cancelled', generation: intent.generation + 1, updatedAt: Date.now() })
    const attempt = await ctx.db.query('agentAssignmentAttempts').withIndex('by_attemptId', q => q.eq('attemptId', intent.attemptId)).unique()
    if (!attempt) continue
    if (!attempt.childRunId && attempt.cancelledAt === undefined) await ctx.db.patch(attempt._id, {
      cancelledAt: Date.now(), cancellationReason: 'Parent run ended before this assignment started',
    })
    await cancelPendingAttemptTurns(ctx, attempt)
  }
}

export async function cancelPendingAttemptTurns(ctx: MutationCtx, attempt: Doc<'agentAssignmentAttempts'>) {
    const queue = await ctx.db.query('agentConversationTurnQueue').withIndex('by_conversationId_state', q => q.eq('conversationId', attempt.conversationId).eq('state', 'pending')).collect()
    for (const item of queue.filter(row => row.attemptId === attempt.attemptId)) {
      await ctx.db.patch(item._id, { state: 'cancelled', generation: item.generation + 1, updatedAt: Date.now() })
      const delivery = await ctx.db.get(item.deliveryAgentRunId)
      if (delivery && !delivery.harnessRunId && delivery.status === 'queued') {
        await ctx.db.patch(delivery._id, { status: 'cancelled', cancelledAt: Date.now(), updatedAt: Date.now() })
        const message = await ctx.db.get(delivery.assistantMessageId)
        if (message?.status === 'generating') await ctx.db.patch(message._id, { status: 'completed', updatedAt: Date.now() })
      }
    }
}
