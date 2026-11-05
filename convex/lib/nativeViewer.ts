import type { Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

type NativeContext = Pick<QueryCtx, 'auth' | 'db'>

export async function nativeViewer(ctx: Pick<QueryCtx, 'auth'>) {
  const identity = await ctx.auth.getUserIdentity()
  return identity?.subject ? { userId: identity.subject } : null
}

export async function requireNativeWorkspace(ctx: NativeContext, workspaceId: string) {
  const viewer = await nativeViewer(ctx)
  if (!viewer) throw new Error('UNAUTHENTICATED')
  const workspace = await ctx.db.query('workspaces')
    .withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).unique()
  if (!workspace || workspace.status !== 'active' || workspace.archivedAt !== undefined) {
    throw new Error('WORKSPACE_ACCESS_DENIED')
  }
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', workspaceId).eq('userId', viewer.userId)).unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt !== undefined) {
    throw new Error('WORKSPACE_ACCESS_DENIED')
  }
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId)).unique()
  if (!membership || membership.status !== 'active') throw new Error('WORKSPACE_ACCESS_DENIED')
  return { ...viewer, workspaceId, principal, membership }
}

// This pilot deliberately excludes shared, agent, external and automation chats.
export async function requireNativePersonalChat(
  ctx: NativeContext,
  args: { workspaceId: string; conversationId: Id<'conversations'> },
) {
  const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
  const conversation = await ctx.db.get(args.conversationId)
  if (!conversation || conversation.deletedAt !== undefined
    || conversation.workspaceId !== viewer.workspaceId || conversation.userId !== viewer.userId
    || (conversation.conversationType ?? 'personal') !== 'personal'
    || (conversation.scope ?? 'personal') !== 'personal'
    || conversation.agentId || conversation.isAutomation || conversation.externalPlatform || conversation.surfaceBindingId) {
    throw new Error('CONVERSATION_ACCESS_DENIED')
  }
  const participant = await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_principalId', q => q.eq('conversationId', args.conversationId)
      .eq('principalId', viewer.principal.principalId)).unique()
  // Personal chats can predate participant rows; existing rows must stay scoped.
  if (participant && (participant.workspaceId !== viewer.workspaceId || participant.principalType !== 'human'
    || participant.status !== 'active' || participant.removedAt !== undefined)) {
    throw new Error('CONVERSATION_ACCESS_DENIED')
  }
  return { ...viewer, conversation, participant }
}
