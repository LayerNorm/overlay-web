import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

async function paramsOf(context: AppApiRouteContext) {
  const params = await context.params
  const conversationId = typeof params.conversationId === 'string' ? params.conversationId.trim() : ''
  const threadRootMessageId = typeof params.threadRootMessageId === 'string' ? params.threadRootMessageId.trim() : ''
  if (!conversationId || !threadRootMessageId) throw new Error('conversationId and threadRootMessageId are required')
  return { conversationId, threadRootMessageId }
}

export async function GET(_request: Request, context: AppApiRouteContext) {
  const { conversationId, threadRootMessageId } = await paramsOf(context)
  const follows = await getOverlayServerContext().appData.repositories.conversationCollaboration.listThreadFollows({
    actorUserId: context.auth.userId,
    conversationId,
    threadRootMessageId,
    workspaceId: context.workspace.workspace.id,
  })
  return NextResponse.json({ following: follows.some((follow) => follow.principalId === context.workspace.principal.id), follows })
}

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  const { conversationId, threadRootMessageId } = await paramsOf(context)
  const followed = context.parsedJson.followed
  if (typeof followed !== 'boolean') return NextResponse.json({ error: 'followed is required' }, { status: 400 })
  const updated = await getOverlayServerContext().appData.repositories.conversationCollaboration.setThreadFollow({
    actorUserId: context.auth.userId,
    conversationId,
    threadRootMessageId,
    followed,
    workspaceId: context.workspace.workspace.id,
  })
  return NextResponse.json({ followed: updated })
}
