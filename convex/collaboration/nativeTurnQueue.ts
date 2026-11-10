import { v } from 'convex/values'
import { mutation, type MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireServerSecret } from '../lib/auth'
import { requireConversationAccess } from './directMessages'

const terminal = (status: string) => ['completed', 'failed', 'cancelled'].includes(status)

export async function enqueueNativeTurn(ctx: Pick<MutationCtx, 'db'>, run: Doc<'conversationAgentRuns'>) {
  const existing = await ctx.db.query('agentConversationTurnQueue').withIndex('by_deliveryAgentRunId', q => q.eq('deliveryAgentRunId', run._id)).unique()
  if (existing) return existing
  if (run.executionEngine !== 'overlay_harness' || !run.agentId) return null
  const conversation = await ctx.db.get(run.conversationId)
  if (!conversation?.workspaceId) return null
  const agent = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', run.agentId!)).unique()
  const assignment = await ctx.db.query('agentAssignments').withIndex('by_conversationId', q => q.eq('conversationId', run.conversationId)).unique()
  if (!assignment && agent?.agentRole !== 'workspace_chief' && agent?.agentRole !== 'personal_chief' && !agent?.isDefault) return null
  const trigger = run.userMessageId ? await ctx.db.get(run.userMessageId) : null
  const attempt = trigger?.turnId ? await ctx.db.query('agentAssignmentAttempts').withIndex('by_conversationId_questionTurnId', q =>
    q.eq('conversationId', run.conversationId).eq('questionTurnId', trigger.turnId!)).unique() : null
  const now = Date.now()
  const id = await ctx.db.insert('agentConversationTurnQueue', { conversationId: run.conversationId,
    deliveryAgentRunId: run._id, requesterUserId: run.userId, workspaceId: conversation.workspaceId,
    attemptId: attempt?.attemptId, state: 'pending', generation: 0, attempts: 0, nextAttemptAt: now,
    authorityPolicyVersion: assignment?.authorityPolicyVersion ?? 0, agentId: run.agentId,
    initiatorPrincipalId: run.initiatorPrincipalId ?? run.userId,
    createdAt: run.createdAt, updatedAt: now })
  return await ctx.db.get(id)
}

async function isPublished(ctx: Pick<MutationCtx, 'db'>, row: Doc<'agentConversationTurnQueue'>) {
  const delivery = await ctx.db.get(row.deliveryAgentRunId)
  if (!delivery) return true
  const message = await ctx.db.get(delivery.assistantMessageId)
  return terminal(delivery.status) && (!message || message.deletedAt !== undefined || message.status !== 'generating')
}

export async function acquireNativeTurn(ctx: Pick<MutationCtx, 'db'>, delivery: Doc<'conversationAgentRuns'>, serverSecret: string, memoryEnabled?: boolean) {
  const item = await enqueueNativeTurn(ctx, delivery)
  if (!item) return true
  if (item.requesterUserId !== delivery.userId || item.agentId !== delivery.agentId
    || item.initiatorPrincipalId !== (delivery.initiatorPrincipalId ?? delivery.userId)) {
    throw new Error('NATIVE_TURN_IDENTITY_CHANGED')
  }
  if (terminal(delivery.status) || item.state === 'settled' || item.state === 'cancelled') return false
  if (item.memoryEnabled === undefined && memoryEnabled !== undefined) await ctx.db.patch(item._id, { memoryEnabled })
  const owners = await ctx.db.query('agentConversationTurnQueue').withIndex('by_conversationId_state', q =>
    q.eq('conversationId', item.conversationId).eq('state', 'claimed')).collect()
  for (const owner of owners) {
    if (await isPublished(ctx, owner)) await ctx.db.patch(owner._id, { state: 'settled', updatedAt: Date.now() })
    else return owner._id === item._id
  }
  const legacy = await ctx.db.query('conversationAgentRuns').withIndex('by_conversationId_createdAt', q => q.eq('conversationId', item.conversationId)).collect()
  for (const run of legacy.filter(row => row._id !== delivery._id && !terminal(row.status) && Boolean(row.workflowRunId))) {
    const queued = await ctx.db.query('agentConversationTurnQueue').withIndex('by_deliveryAgentRunId', q => q.eq('deliveryAgentRunId', run._id)).unique()
    if (!queued || queued.state === 'claimed') return false
  }
  const pending = await ctx.db.query('agentConversationTurnQueue').withIndex('by_conversationId_state', q =>
    q.eq('conversationId', item.conversationId).eq('state', 'pending')).collect()
  for (const head of pending) {
    if (await isPublished(ctx, head)) {
      await ctx.db.patch(head._id, { state: 'settled', updatedAt: Date.now() })
      continue
    }
    try {
      await requireConversationAccess(ctx, { actorUserId: head.requesterUserId, conversationId: head.conversationId,
        workspaceId: head.workspaceId, serverSecret })
    } catch {
      await ctx.db.patch(head._id, { state: 'cancelled', generation: head.generation + 1, updatedAt: Date.now() })
      const denied = await ctx.db.get(head.deliveryAgentRunId)
      if (denied?.status === 'queued' && !denied.workflowRunId) await ctx.db.patch(denied._id, {
        status: 'waiting_for_authorization', updatedAt: Date.now(),
      })
      continue
    }
    if (head._id !== item._id) return false
    await ctx.db.patch(item._id, { state: 'claimed', updatedAt: Date.now() })
    return true
  }
  return false
}

export const acquire = mutation({
  args: { serverSecret: v.string(), actorUserId: v.string(), deliveryAgentRunId: v.id('conversationAgentRuns'), memoryEnabled: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const delivery = await ctx.db.get(args.deliveryAgentRunId)
    if (!delivery || delivery.userId !== args.actorUserId) throw new Error('CONVERSATION_ACCESS_DENIED')
    const conversation = await ctx.db.get(delivery.conversationId)
    if (!conversation || conversation.deletedAt !== undefined) throw new Error('CONVERSATION_ACCESS_DENIED')
    if (conversation.workspaceId === undefined) {
      if ((conversation.conversationType ?? 'personal') !== 'personal' || delivery.mode === 'room'
        || conversation.userId !== args.actorUserId) {
        throw new Error('CONVERSATION_ACCESS_DENIED')
      }
      return true
    }
    if (!conversation.workspaceId) throw new Error('CONVERSATION_ACCESS_DENIED')
    await requireConversationAccess(ctx, { ...args, conversationId: delivery.conversationId, workspaceId: conversation.workspaceId })
    return await acquireNativeTurn(ctx, delivery, args.serverSecret, args.memoryEnabled)
  },
})
