import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

async function id(context: AppApiRouteContext) {
  const value = (await context.params).conversationId
  if (typeof value !== 'string') throw new Error('conversationId is required')
  return value
}

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const presence = await getOverlayServerContext().appData.repositories
      .conversationCollaboration.listPresence({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        conversationId: await id(context),
      })
    return NextResponse.json({ presence })
  } catch (_error) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  const status = context.parsedJson.status === 'away' || context.parsedJson.status === 'offline'
    ? context.parsedJson.status
    : 'online'
  try {
    const presence = await getOverlayServerContext().appData.repositories
      .conversationCollaboration.upsertPresence({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        conversationId: await id(context),
        sessionId: typeof context.parsedJson.sessionId === 'string'
          ? context.parsedJson.sessionId.trim()
          : undefined,
        status,
        typing: context.parsedJson.typing === true,
      })
    return NextResponse.json({ presence })
  } catch (_error) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
