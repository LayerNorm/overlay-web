import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { requireAgentAuthor } from '../collaboration/directMessages'
import type { HarnessAdmission, HarnessSource } from '../../packages/overlay-agent-runtime/src/harness-store'

type ReadContext = Pick<QueryCtx, 'db'>

export function isHarnessDeliveryConversation(
  conversation: Doc<'conversations'> | null,
  delivery: Doc<'conversationAgentRuns'>,
  runId: string,
): boolean {
  if (!conversation || conversation.deletedAt || conversation._id !== delivery.conversationId) return false
  if (delivery.mode !== 'room') {
    return conversation.userId === delivery.userId && (conversation.conversationType ?? 'personal') === 'personal'
  }
  // Cancellation uses the immutable admission binding, even after agent access is revoked.
  return (conversation.conversationType ?? 'personal') !== 'personal' && Boolean(conversation.workspaceId)
    && delivery.executionEngine === 'overlay_harness' && Boolean(delivery.agentId && delivery.agentPrincipalId)
    && runId === `workspace:${delivery._id}`
}

export async function validateNativeHarnessDelivery(
  ctx: ReadContext,
  admission: HarnessAdmission,
  source: HarnessSource,
  delivery: Doc<'conversationAgentRuns'>,
  serverSecret: string,
): Promise<Doc<'conversationAgentRuns'>> {
  const conversationId = typeof source.conversationId === 'string'
    ? ctx.db.normalizeId('conversations', source.conversationId) : null
  const conversation = conversationId ? await ctx.db.get(conversationId) : null
  if (!isHarnessDeliveryConversation(conversation, delivery, admission.runId)
    || conversation?.workspaceId !== admission.policy.workspaceId) {
    throw new Error('HARNESS_DELIVERY_SOURCE_DENIED')
  }
  if (delivery.userId !== admission.policy.actorUserId || delivery.runner !== 'workflow'
    || delivery.status !== 'queued' || delivery.startedAt !== undefined
    || delivery.workflowRunId !== undefined || delivery.harnessRunId !== undefined
    || delivery.completedAt !== undefined || delivery.failedAt !== undefined || delivery.cancelledAt !== undefined) {
    throw new Error('HARNESS_DELIVERY_TARGET_DENIED')
  }
  await requireAgentAuthor(ctx, {
    actorUserId: admission.policy.actorUserId, authorPrincipalId: delivery.agentPrincipalId!,
    conversationId: conversation!._id, workspaceId: conversation!.workspaceId!, serverSecret,
  })
  const [agent, message, trigger] = await Promise.all([
    ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', delivery.agentId!)).unique(),
    ctx.db.get(delivery.assistantMessageId), ctx.db.get(delivery.userMessageId),
  ])
  if (!agent || agent.harness !== 'overlay' || agent.archivedAt !== undefined || agent.deletedAt !== undefined
    || agent.workspaceId !== admission.policy.workspaceId || agent.principalId !== delivery.agentPrincipalId
    || !message || message.conversationId !== conversationId || message.userId !== delivery.userId
    || message.authorKind !== 'agent' || message.authorPrincipalId !== delivery.agentPrincipalId
    || message.role !== 'assistant' || message.turnId !== delivery.turnId || message.status !== 'generating' || message.deletedAt
    || !trigger || trigger.conversationId !== conversationId || trigger.deletedAt) {
    throw new Error('HARNESS_DELIVERY_AGENT_DENIED')
  }
  return delivery
}
