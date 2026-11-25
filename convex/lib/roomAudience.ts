import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { isSharedRoom } from '../../src/shared/agents/room-access'

/**
 * The workspace automation this conversation is the thread of, if any (internal/plans/WORKSPACE_PERSONAL_SEPARATION_PLAN.md,
 * P6). An archived automation keeps the scope it was archived from, so its thread stays a workspace context.
 */
export async function workspaceAutomationForThread(
  ctx: MutationCtx | QueryCtx,
  conversationId: Id<'conversations'>,
): Promise<Doc<'automations'> | null> {
  const automations = await ctx.db.query('automations')
    .withIndex('by_conversationId_deletedAt', q => q.eq('conversationId', conversationId).eq('deletedAt', undefined))
    .take(20)
  return automations.find(automation => automation.sourceConversationId !== conversationId
    && (automation.archivedAt !== undefined ? automation.archivedFromScope ?? automation.scope : automation.scope) === 'workspace')
    ?? null
}

/**
 * Whether this conversation is a workspace context: people other than the asker can read it (`isSharedRoom`: an
 * external surface such as Slack, a channel, or a room with more than one active person), or it is a workspace
 * automation's thread. Either way the turn uses only workspace reach (connectors, MCP servers, provider keys, memories,
 * skills and files), and what an agent learns there is workspace knowledge.
 */
export async function conversationAudienceIsShared(ctx: MutationCtx | QueryCtx, conversationId: string): Promise<boolean> {
  const id = ctx.db.normalizeId('conversations', conversationId)
  const conversation = id ? await ctx.db.get(id) : null
  if (!conversation || conversation.deletedAt !== undefined) throw new Error('CONVERSATION_ACCESS_DENIED')
  if (conversation.externalPlatform !== undefined || conversation.surfaceBindingId !== undefined) return true
  if (conversation.origin?.kind === 'channel') return true
  if (await workspaceAutomationForThread(ctx, conversation._id)) return true
  const participants = await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_principalId', q => q.eq('conversationId', conversation._id))
    .collect()
  return isSharedRoom({
    conversationType: conversation.conversationType ?? 'personal',
    channelVisibility: conversation.channelVisibility,
    humanParticipants: participants.filter(participant => participant.status === 'active'
      && participant.principalType === 'human').length,
  })
}
