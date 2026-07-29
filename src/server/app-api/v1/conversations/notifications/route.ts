import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

export async function GET(_request: Request, context: AppApiRouteContext) {
  const notifications = await getOverlayServerContext().appData.repositories
    .conversationCollaboration.listNotifications({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      unreadOnly: context.parsedQuery.unreadOnly === 'true',
      limit: typeof context.parsedQuery.limit === 'string'
        ? Number(context.parsedQuery.limit)
        : undefined,
    })
  return NextResponse.json({ notifications })
}

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  const notificationIds = Array.isArray(context.parsedJson.notificationIds)
    ? context.parsedJson.notificationIds.filter((value): value is string => typeof value === 'string')
    : undefined
  const updated = await getOverlayServerContext().appData.repositories
    .conversationCollaboration.markNotificationsRead({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      notificationIds,
    })
  return NextResponse.json({ updated })
}
