import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/**
 * Puts an agent in every public channel of its workspace, as a member who answers mentions. A workspace-visible agent
 * joins them when it is created, and a creator-only agent when it is moved to the workspace. Channels it is already in
 * are left alone.
 */
export async function joinPublicChannels(ctx: MutationCtx, args: { workspaceId: string; principalId: string; now: number }) {
  const channels = await ctx.db
    .query('conversations')
    .withIndex('by_workspaceId_conversationType_lastModified', (q) =>
      q.eq('workspaceId', args.workspaceId).eq('conversationType', 'channel'))
    .collect()
  for (const channel of channels) {
    if (channel.deletedAt || channel.channelVisibility !== 'public') continue
    const existing = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_conversationId_principalId', (q) => q.eq('conversationId', channel._id).eq('principalId', args.principalId))
      .first()
    if (existing) continue
    await ctx.db.insert('conversationParticipants', {
      conversationId: channel._id, workspaceId: args.workspaceId, principalId: args.principalId,
      principalType: 'agent', role: 'member', status: 'active', notificationLevel: 'mentions',
      joinedAt: args.now, updatedAt: args.now,
    })
  }
}

/**
 * Moves a creator-only agent to the workspace: everyone can see it, and it joins the public channels like a new
 * workspace agent. One-way: nothing moves an agent back to creator-only.
 */
export async function moveAgentToWorkspace(ctx: MutationCtx, row: Doc<'workspaceAgentDefinitions'>, now: number) {
  if ((row.visibility ?? 'workspace') === 'workspace') return
  await ctx.db.patch(row._id, { visibility: 'workspace', updatedAt: now })
  await joinPublicChannels(ctx, { workspaceId: row.workspaceId, principalId: row.principalId, now })
}
