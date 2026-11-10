import { ConvexError, v } from 'convex/values'
import { mutation, query, type MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'
import { requireConversationAccess } from './directMessages'
import { authorizeAssignmentAttempt, settleAssignmentAttempt } from './assignmentResults'
import { assignmentCompletionIssues, cancelPendingAssignmentLaunches, cancelPendingAttemptTurns } from './assignmentObligations'
import { cancelHarnessDelivery, settleResolvedAssignmentChild } from '../harness/runs'
import { INTERRUPTED_RESPONSE_NOTICE } from '../../src/shared/chat/agent-assistant-text'
import type { AssignmentCancellationRoot } from '../../src/shared/agents/assignment-recovery'

export async function assignmentCancellationRoot(ctx: MutationCtx, run: Doc<'harnessRuns'>): Promise<AssignmentCancellationRoot | undefined> {
  const id = run.deliveryAgentRunId ? ctx.db.normalizeId('conversationAgentRuns', run.deliveryAgentRunId) : null
  const delivery = id ? await ctx.db.get(id) : null
  return delivery?.status === 'cancelled' ? { actorUserId: run.actorUserId, agentRunId: delivery._id, rootRunId: run.runId } : undefined
}

export async function cancelOutstandingAssignments(ctx: MutationCtx, parentRunId: string, serverSecret: string) {
  const attempts = await ctx.db.query('agentAssignmentAttempts').withIndex('by_parentRunId', q => q.eq('parentRunId', parentRunId)).collect()
  for (const attempt of attempts) {
    const intent = await ctx.db.query('agentAssignmentLaunchIntents').withIndex('by_attemptId', q => q.eq('attemptId', attempt.attemptId)).unique()
    if (intent && intent.state !== 'cancelled') await ctx.db.patch(intent._id, { state: 'cancelled', generation: intent.generation + 1, updatedAt: Date.now() })
    const child = attempt.childRunId ? await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', attempt.childRunId!)).unique() : null
    if (child) await cancelAssignmentSubtree(ctx, child, serverSecret)
  }
}

export async function cancelAssignmentSubtree(ctx: MutationCtx, run: Doc<'harnessRuns'>, serverSecret: string): Promise<string[]> {
  const children = await ctx.db.query('harnessRuns').withIndex('by_parentRunId', q => q.eq('parentRunId', run.runId)).collect()
  const workflows: string[] = []
  for (const child of children) workflows.push(...await cancelAssignmentSubtree(ctx, child, serverSecret))
  const metadata = JSON.parse(run.metadataJson)
  if (metadata.workflowRunId) workflows.push(metadata.workflowRunId)
  await cancelPendingAssignmentLaunches(ctx, run.runId)
  const deliveryId = run.deliveryAgentRunId ? ctx.db.normalizeId('conversationAgentRuns', run.deliveryAgentRunId) : null
  const delivery = deliveryId ? await ctx.db.get(deliveryId) : null
  if (!delivery) return workflows
  await cancelHarnessDelivery(ctx, delivery, Date.now(), serverSecret)
  if (['completed', 'failed'].includes(delivery.status)) return delivery.workflowRunId ? [...workflows, delivery.workflowRunId] : workflows
  const message = await ctx.db.get(delivery.assistantMessageId)
  if (message?.status === 'generating') await ctx.db.patch(message._id, {
    status: 'completed', content: `${message.content}\n\n${INTERRUPTED_RESPONSE_NOTICE}`, updatedAt: Date.now(),
    parts: [{ type: 'text', text: `${message.content}\n\n${INTERRUPTED_RESPONSE_NOTICE}` }],
  })
  await ctx.db.patch(delivery._id, { status: 'cancelled', cancelledAt: Date.now(), leaseExpiresAt: undefined,
    approval: undefined, inputRequest: undefined, resourceRequest: undefined, updatedAt: Date.now() })
  await settleAssignmentAttempt(ctx, run.runId)
  if (delivery.workflowRunId) workflows.push(delivery.workflowRunId)
  return workflows
}

export const issues = query({
  args: { serverSecret: v.string(), actorUserId: v.string(), parentRunId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const run = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', args.parentRunId)).unique()
    if (!run || run.actorUserId !== args.actorUserId) throw new Error('ASSIGNMENT_ACCESS_DENIED')
    const source = JSON.parse(run.sourceJson) as { conversationId?: string }
    const conversationId = source.conversationId ? ctx.db.normalizeId('conversations', source.conversationId) : null
    if (!conversationId) return []
    await requireConversationAccess(ctx, { ...args, conversationId, workspaceId: JSON.parse(run.metadataJson).policy.workspaceId })
    return await assignmentCompletionIssues(ctx, run.runId)
  },
})

async function rejectResolution(ctx: MutationCtx, args: { serverSecret: string; actorUserId: string; workspaceId: string; assignmentId: string; parentRunId: string }, error: string): Promise<never> {
  const assignment = await ctx.db.query('agentAssignments').withIndex('by_assignmentId', q => q.eq('assignmentId', args.assignmentId)).unique()
  const attempt = assignment?.currentAttemptId
    ? await ctx.db.query('agentAssignmentAttempts').withIndex('by_attemptId', q => q.eq('attemptId', assignment.currentAttemptId!)).unique() : null
  let currentAttemptId: string | undefined
  if (attempt && attempt.parentRunId === args.parentRunId) {
    try {
      await authorizeAssignmentAttempt(ctx, args, attempt)
      currentAttemptId = attempt.attemptId
    } catch { /* Unreadable assignments must not disclose their handles. */ }
  }
  throw new ConvexError({ code: 'ASSIGNMENT_RESOLUTION_REJECTED', error,
    hint: currentAttemptId ? 'Use the current attempt ID. Accept only completed results; exclude or cancel with a reason.'
      : 'Read an assignment you are authorized to access and use its exact current attempt ID.',
    ...(currentAttemptId ? { currentAttemptId } : {}) })
}

export const resolve = mutation({
  args: { serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(), parentRunId: v.string(),
    workflowRunId: v.string(), executionGeneration: v.number(), assignmentId: v.string(), attemptId: v.string(),
    action: v.union(v.literal('accept'), v.literal('exclude'), v.literal('cancel')), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const run = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', args.parentRunId)).unique()
    const metadata = run ? JSON.parse(run.metadataJson) : null
    if (!run || run.actorUserId !== args.actorUserId || metadata.workflowRunId !== args.workflowRunId
      || (metadata.executionGeneration ?? 0) !== args.executionGeneration || ['completed', 'failed', 'cancelled'].includes(metadata.status)) throw new Error('ASSIGNMENT_ACCESS_DENIED')
    const attempt = await ctx.db.query('agentAssignmentAttempts').withIndex('by_attemptId', q => q.eq('attemptId', args.attemptId)).unique()
    if (!attempt || attempt.assignmentId !== args.assignmentId) return await rejectResolution(ctx, args, 'ASSIGNMENT_ATTEMPT_NOT_FOUND')
    const assignment = await authorizeAssignmentAttempt(ctx, args, attempt)
    const source = JSON.parse(run.sourceJson)
    const deliveryId = run.deliveryAgentRunId ? ctx.db.normalizeId('conversationAgentRuns', run.deliveryAgentRunId) : null
    const delivery = deliveryId ? await ctx.db.get(deliveryId) : null
    if (assignment.requesterUserId !== args.actorUserId || assignment.callerAgentId !== delivery?.agentId
      || assignment.parentConversationId !== source.conversationId) throw new Error('ASSIGNMENT_ACCESS_DENIED')
    if (assignment.currentAttemptId !== args.attemptId) return await rejectResolution(ctx, args, 'ASSIGNMENT_REVISION_CONFLICT')
    const disposition = args.action === 'accept' ? 'accepted' as const : 'excluded' as const
    const reason = args.reason?.trim()
    if (args.action !== 'accept' && !reason) return await rejectResolution(ctx, args, 'ASSIGNMENT_REASON_REQUIRED')
    if (attempt.disposition && (attempt.disposition !== disposition || attempt.dispositionReason !== reason)) return await rejectResolution(ctx, args, 'ASSIGNMENT_ALREADY_RESOLVED')
    if (attempt.childRunId) await settleAssignmentAttempt(ctx, attempt.childRunId)
    const result = await ctx.db.query('agentAssignmentResults').withIndex('by_attemptId', q => q.eq('attemptId', args.attemptId)).unique()
    if (args.action === 'accept' && (!result?.terminal || result.publicationPending || result.runStatus !== 'completed')) return await rejectResolution(ctx, args, 'ASSIGNMENT_RESULT_NOT_ACCEPTABLE')
    if (args.action === 'accept') {
      const reply = result?.finalReplyMessageId ? await ctx.db.get(result.finalReplyMessageId) : null
      if (!reply || reply.deletedAt !== undefined || reply.status !== 'completed') return await rejectResolution(ctx, args, 'ASSIGNMENT_RESULT_NOT_ACCEPTABLE')
    }
    await ctx.db.patch(attempt._id, { disposition, dispositionReason: reason, disposedByRunId: run.runId, disposedAt: attempt.disposedAt ?? Date.now() })
    const workflows: string[] = []
    if (args.action !== 'accept') {
      await cancelPendingAttemptTurns(ctx, attempt)
      const intent = await ctx.db.query('agentAssignmentLaunchIntents').withIndex('by_attemptId', q => q.eq('attemptId', attempt.attemptId)).unique()
      if (intent && intent.state !== 'settled' && intent.state !== 'cancelled') await ctx.db.patch(intent._id, {
        state: 'cancelled', generation: intent.generation + 1, updatedAt: Date.now(),
      })
      const child = attempt.childRunId ? await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', attempt.childRunId!)).unique() : null
      if (child) workflows.push(...await cancelAssignmentSubtree(ctx, child, args.serverSecret))
    }
    const child = attempt.childRunId ? await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', attempt.childRunId!)).unique() : null
    if (child?.parentRunId === run.runId) await settleResolvedAssignmentChild(ctx, run, child, args.action !== 'accept')
    const previousAttempts = await ctx.db.query('agentAssignmentAttempts').withIndex('by_assignmentId_ordinal', q => q.eq('assignmentId', assignment.assignmentId)).collect()
    for (const previous of previousAttempts) {
      if (previous.disposition !== 'revision_requested' || previous.parentRunId !== run.runId || !previous.childRunId) continue
      const previousChild = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', previous.childRunId!)).unique()
      if (previousChild?.parentRunId === run.runId) await settleResolvedAssignmentChild(ctx, run, previousChild, false)
    }
    return { assignmentId: assignment.assignmentId, attemptId: attempt.attemptId, disposition, reason,
      workflows: [...new Set(workflows)], cancellationRoot: child ? await assignmentCancellationRoot(ctx, child) : undefined }
  },
})
