import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

async function conversationId(context: AppApiRouteContext) {
  const value = (await context.params).conversationId
  if (typeof value !== 'string' || !value.trim()) throw new Error('conversationId is required')
  return value.trim()
}

export async function GET(_request: Request, context: AppApiRouteContext) {
  const reactions = await getOverlayServerContext().appData.repositories
    .conversationCollaboration.listReactions({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      conversationId: await conversationId(context),
    })
  return NextResponse.json({ reactions })
}

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  const { messageId, emoji, enabled } = context.parsedJson
  if (typeof messageId !== 'string' || typeof emoji !== 'string' || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'messageId, emoji, and enabled are required' }, { status: 400 })
  }
  const reactions = await getOverlayServerContext().appData.repositories
    .conversationCollaboration.setReaction({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      conversationId: await conversationId(context),
      messageId,
      emoji,
      enabled,
    })
  return NextResponse.json({ reactions })
}
