import type { Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeDeploymentFeature } from '../lib/nativeDeploymentPolicy'
import { requireNativeCapability } from '../lib/nativeCapabilities'

type Context = Pick<QueryCtx, 'auth' | 'db'>
export type NativeRoomArgs = { workspaceId: string; conversationId: Id<'conversations'> }

export async function requireNativeRoom(ctx: Context, args: NativeRoomArgs) {
  const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
  await requireNativeDeploymentFeature(ctx, 'chat', args.workspaceId)
  await requireNativeCapability(ctx, viewer.userId, 'conversations.read')
  return requireRoomForViewer(ctx, args, viewer)
}

async function requireRoomForViewer(ctx: Pick<QueryCtx, 'db'>, args: NativeRoomArgs, viewer: Awaited<ReturnType<typeof requireNativeWorkspace>>) {
  if (viewer.workspaceId !== args.workspaceId) throw new Error('ROOM_ACCESS_DENIED')
  const conversation = await ctx.db.get(args.conversationId)
  if (!conversation || conversation.deletedAt !== undefined || conversation.workspaceId !== args.workspaceId
    || (conversation.conversationType !== 'dm' && conversation.conversationType !== 'channel')) {
    throw new Error('ROOM_ACCESS_DENIED')
  }
  const participant = await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_principalId', q => q.eq('conversationId', args.conversationId)
      .eq('principalId', viewer.principal.principalId)).unique()
  if (!participant || participant.workspaceId !== args.workspaceId || participant.principalType !== 'human'
    || participant.status !== 'active' || participant.removedAt !== undefined) throw new Error('ROOM_ACCESS_DENIED')
  if (conversation.agentId) {
    const agent = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_agentId', q => q.eq('agentId', conversation.agentId!)).unique()
    if (!agent || agent.workspaceId !== args.workspaceId || agent.archivedAt !== undefined) {
      throw new Error('ROOM_ACCESS_DENIED')
    }
  }
  return { viewer, principal: viewer.principal, membership: viewer.membership, conversation, participant }
}

export async function roomForAuthorizedViewerOrNull(ctx: Pick<QueryCtx, 'db'>, args: NativeRoomArgs, viewer: Awaited<ReturnType<typeof requireNativeWorkspace>>) {
  try {
    return await requireRoomForViewer(ctx, args, viewer)
  } catch (error) {
    if (error instanceof Error && error.message === 'ROOM_ACCESS_DENIED') return null
    throw error
  }
}

export async function nativeRoomOrNull(ctx: Context, args: NativeRoomArgs) {
  try {
    return await requireNativeRoom(ctx, args)
  } catch (error) {
    if (error instanceof Error && ['UNAUTHENTICATED', 'WORKSPACE_ACCESS_DENIED', 'ROOM_ACCESS_DENIED',
      'DEPLOYMENT_FEATURE_ACCESS_DENIED', 'CAPABILITY_ACCESS_DENIED'].includes(error.message)) return null
    throw error
  }
}
