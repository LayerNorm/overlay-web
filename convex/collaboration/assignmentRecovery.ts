import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, type MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'
import { settleAssignmentAttempt } from './assignmentResults'
import { assignmentCancellationRoot, cancelAssignmentSubtree } from './assignmentCoordination'
import { cancelPendingAssignmentLaunches, cancelPendingAttemptTurns } from './assignmentObligations'
import type { NativeRecoveryRequest, NativeRecoveryWork } from '../../src/shared/agents/assignment-recovery'

const terminal = (status: string) => ['completed', 'failed', 'cancelled'].includes(status)

async function publicationWork(ctx: MutationCtx, delivery: Doc<'conversationAgentRuns'>): Promise<NativeRecoveryWork | null> {
  const run = delivery.harnessRunId ? await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', delivery.harnessRunId!)).unique() : null
  if (!run) return null
  const metadata = JSON.parse(run.metadataJson)
  if (!terminal(metadata.status)) {
    if (metadata.workflowRunId && !delivery.workflowRunId) await ctx.db.patch(delivery._id, { workflowRunId: metadata.workflowRunId, updatedAt: Date.now() })
    return null
  }
  const message = await ctx.db.get(delivery.assistantMessageId)
  if ((delivery.status === 'failed' || delivery.status === 'cancelled') && message?.status === 'generating') {
    await ctx.db.patch(message._id, { status: delivery.status === 'failed' ? 'error' : 'completed',
      content: message.content || metadata.terminalReason || '', updatedAt: Date.now() })
    await settleAssignmentAttempt(ctx, run.runId)
    return null
  }
  if (terminal(delivery.status) && (!message || message.deletedAt !== undefined || message.status !== 'generating')) {
    await settleAssignmentAttempt(ctx, run.runId)
    return null
  }
  const conversation = await ctx.db.get(delivery.conversationId)
  if (!metadata.workflowRunId || !conversation?.workspaceId) return null
  if (!delivery.workflowRunId) await ctx.db.patch(delivery._id, { workflowRunId: metadata.workflowRunId, updatedAt: Date.now() })
  const queue = await ctx.db.query('agentConversationTurnQueue').withIndex('by_deliveryAgentRunId', q => q.eq('deliveryAgentRunId', delivery._id)).unique()
  return { kind: 'publication', actorUserId: delivery.userId, workspaceId: conversation.workspaceId,
    conversationId: delivery.conversationId, deliveryRunId: delivery._id, runId: run.runId,
    workflowRunId: metadata.workflowRunId, executionGeneration: metadata.executionGeneration ?? 0, memoryEnabled: queue?.memoryEnabled ?? false }
}

async function assignmentWork(ctx: MutationCtx, intent: Doc<'agentAssignmentLaunchIntents'>, serverSecret: string): Promise<NativeRecoveryWork | null> {
  const attempt = await ctx.db.query('agentAssignmentAttempts').withIndex('by_attemptId', q => q.eq('attemptId', intent.attemptId)).unique()
  if (!attempt) return null
  const parent = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', intent.parentRunId)).unique()
  const metadata = parent ? JSON.parse(parent.metadataJson) : null
  if (!parent || !metadata || terminal(metadata.status) || intent.state === 'cancelled') {
    await cancelPendingAssignmentLaunches(ctx, intent.parentRunId)
    await cancelPendingAttemptTurns(ctx, attempt)
    const child = attempt.childRunId ? await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', attempt.childRunId!)).unique() : null
    const workflows = child ? await cancelAssignmentSubtree(ctx, child, serverSecret) : []
    await ctx.db.patch(intent._id, { state: 'cancelled', updatedAt: Date.now() })
    return { kind: 'cancel', workflows: [...new Set(workflows)], cancellationRoot: child ? await assignmentCancellationRoot(ctx, child) : undefined }
  }
  if (attempt.deliveryAgentRunId) {
    const delivery = await ctx.db.get(attempt.deliveryAgentRunId)
    if (delivery) {
      const publication = await publicationWork(ctx, delivery)
      if (publication) return publication
      const child = attempt.childRunId ? await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', attempt.childRunId!)).unique() : null
      if (child && JSON.parse(child.metadataJson).workflowRunId) return null
    }
  }
  if (intent.state !== 'pending' || !metadata.workflowRunId || metadata.status === 'waiting_for_authorization') return null
  const assignment = await ctx.db.query('agentAssignments').withIndex('by_assignmentId', q => q.eq('assignmentId', attempt.assignmentId)).unique()
  const source = JSON.parse(parent.sourceJson)
  if (!assignment || !parent.deliveryAgentRunId || source.conversationId !== assignment.parentConversationId) return null
  return { kind: 'assignment', actorUserId: attempt.requesterUserId, workspaceId: attempt.workspaceId,
    conversationId: assignment.parentConversationId, deliveryRunId: parent.deliveryAgentRunId,
    parentRunId: parent.runId, rootRunId: parent.rootRunId, workflowRunId: metadata.workflowRunId,
    executionGeneration: metadata.executionGeneration ?? 0,
    toolCallId: attempt.dispatchKey.slice(`harness-run:${parent.runId}:tool:`.length), agentId: assignment.assignedAgentId,
    brief: attempt.brief, ...(attempt.ordinal > 1 ? { assignmentId: assignment.assignmentId, expectedAttemptId: attempt.expectedAttemptId } : {}) }
}

async function turnWork(ctx: MutationCtx, item: Doc<'agentConversationTurnQueue'>, serverSecret: string): Promise<NativeRecoveryWork | null> {
  if (item.state !== 'pending' && item.state !== 'claimed') return null
  const delivery = await ctx.db.get(item.deliveryAgentRunId)
  if (!delivery) return null
  const publication = await publicationWork(ctx, delivery)
  if (publication) return publication
  const message = await ctx.db.get(delivery.assistantMessageId)
  if (terminal(delivery.status) && (!message || message.deletedAt !== undefined || message.status !== 'generating')) {
    await ctx.db.patch(item._id, { state: 'settled', updatedAt: Date.now() })
    return null
  }
  if (delivery.workflowRunId) return null
  if (item.attemptId) {
    const intent = await ctx.db.query('agentAssignmentLaunchIntents').withIndex('by_attemptId', q => q.eq('attemptId', item.attemptId!)).unique()
    return intent ? await assignmentWork(ctx, intent, serverSecret) : null
  }
  return { kind: 'turn', actorUserId: item.requesterUserId, workspaceId: item.workspaceId,
    conversationId: item.conversationId, deliveryRunId: item.deliveryAgentRunId, memoryEnabled: item.memoryEnabled ?? false }
}

export const work = mutation({
  args: { serverSecret: v.string(), kind: v.union(v.literal('assignment'), v.literal('turn')), id: v.string(), generation: v.number() },
  handler: async (ctx, args): Promise<NativeRecoveryWork | null> => {
    requireServerSecret(args.serverSecret)
    if (args.kind === 'assignment') {
      const id = ctx.db.normalizeId('agentAssignmentLaunchIntents', args.id)
      const intent = id ? await ctx.db.get(id) : null
      return intent && intent.generation === args.generation && intent.state !== 'settled' ? await assignmentWork(ctx, intent, args.serverSecret) : null
    }
    const id = ctx.db.normalizeId('agentConversationTurnQueue', args.id)
    const item = id ? await ctx.db.get(id) : null
    return item && item.generation === args.generation ? await turnWork(ctx, item, args.serverSecret) : null
  },
})

export const listDue = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args): Promise<NativeRecoveryRequest[]> => {
    const requests: Array<NativeRecoveryRequest & { nextAttemptAt: number }> = []
    for (const state of ['pending', 'launched', 'cancelled'] as const) {
      const items = await ctx.db.query('agentAssignmentLaunchIntents').withIndex('by_state_nextAttemptAt', q => q.eq('state', state).lte('nextAttemptAt', args.now)).take(25)
      requests.push(...items.map(item => ({ kind: 'assignment' as const, id: item._id, generation: item.generation, nextAttemptAt: item.nextAttemptAt })))
    }
    for (const state of ['pending', 'claimed'] as const) {
      const items = await ctx.db.query('agentConversationTurnQueue').withIndex('by_state_nextAttemptAt', q => q.eq('state', state).lte('nextAttemptAt', args.now)).take(25)
      requests.push(...items.map(item => ({ kind: 'turn' as const, id: item._id, generation: item.generation, nextAttemptAt: item.nextAttemptAt })))
    }
    return requests.sort((a, b) => a.nextAttemptAt - b.nextAttemptAt).slice(0, 25).map(({ kind, id, generation }) => ({ kind, id, generation }))
  },
})

export const noteAttempt = internalMutation({
  args: { kind: v.union(v.literal('assignment'), v.literal('turn')), id: v.string(), generation: v.number() },
  handler: async (ctx, args) => {
    const id = args.kind === 'assignment' ? ctx.db.normalizeId('agentAssignmentLaunchIntents', args.id) : ctx.db.normalizeId('agentConversationTurnQueue', args.id)
    const item = id ? await ctx.db.get(id) : null
    if (!item || item.generation !== args.generation) return
    await ctx.db.patch(item._id, { attempts: item.attempts + 1,
      nextAttemptAt: Date.now() + Math.min(15 * 60_000, 1000 * 2 ** Math.min(item.attempts, 9)), updatedAt: Date.now() })
  },
})

export const acknowledge = mutation({
  args: { serverSecret: v.string(), kind: v.union(v.literal('assignment'), v.literal('turn')), id: v.string(), generation: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (args.kind !== 'assignment') return
    const id = ctx.db.normalizeId('agentAssignmentLaunchIntents', args.id)
    const intent = id ? await ctx.db.get(id) : null
    if (intent?.generation === args.generation && intent.state === 'cancelled') await ctx.db.patch(intent._id, { state: 'settled', updatedAt: Date.now() })
  },
})
