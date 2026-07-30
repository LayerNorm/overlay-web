import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

export async function GET(_request: Request, context: AppApiRouteContext) {
  const savedMessages = await getOverlayServerContext().appData.repositories
    .conversationCollaboration.listSavedMessages({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
  return NextResponse.json({ savedMessages })
}

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  const { conversationId, messageId, saved } = context.parsedJson
  if (typeof conversationId !== 'string' || typeof messageId !== 'string' || typeof saved !== 'boolean') {
    return NextResponse.json({ error: 'conversationId, messageId, and saved are required' }, { status: 400 })
  }
  const updated = await getOverlayServerContext().appData.repositories
    .conversationCollaboration.setSaved({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      conversationId,
      messageId,
      saved,
    })
  return NextResponse.json({ saved: updated })
}
