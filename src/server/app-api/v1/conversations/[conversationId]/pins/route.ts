import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

async function conversationId(context: AppApiRouteContext) {
  const value = (await context.params).conversationId
  if (typeof value !== 'string' || !value.trim()) throw new Error('conversationId is required')
  return value.trim()
}

export async function GET(_request: Request, context: AppApiRouteContext) {
  const pins = await getOverlayServerContext().appData.repositories
    .conversationCollaboration.listPins({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      conversationId: await conversationId(context),
    })
  return NextResponse.json({ pins })
}

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  const { messageId, pinned } = context.parsedJson
  if (typeof messageId !== 'string' || typeof pinned !== 'boolean') {
    return NextResponse.json({ error: 'messageId and pinned are required' }, { status: 400 })
  }
  const updated = await getOverlayServerContext().appData.repositories
    .conversationCollaboration.setPinned({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      conversationId: await conversationId(context),
      messageId,
      pinned,
    })
  return NextResponse.json({ pinned: updated })
}
