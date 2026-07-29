import { NextResponse } from 'next/server'
import type { ConversationParticipantStateInput } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  const conversationId = (await context.params).conversationId
  if (typeof conversationId !== 'string') {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }
  const input = context.parsedJson as ConversationParticipantStateInput
  try {
    const participant = await getOverlayServerContext().appData.repositories
      .conversationCollaboration.updateParticipantState({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        conversationId,
        notificationLevel: input.notificationLevel,
        archived: input.archived,
        markUnread: input.markUnread,
        markRead: input.markRead,
      })
    return NextResponse.json({ participant })
  } catch (_error) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
