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
    const collaboration = getOverlayServerContext().appData.repositories.conversationCollaboration
    if (input.archiveScope === 'everyone' && input.archived !== undefined) {
      if (context.workspace.membership.role !== 'owner') {
        return NextResponse.json({ error: 'Workspace owner required' }, { status: 403 })
      }
      const participant = await collaboration.archiveConversationForEveryone({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        conversationId,
        archived: input.archived,
      })
      return NextResponse.json({ participant, scope: 'everyone' })
    }
    const participant = await collaboration.updateParticipantState({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      conversationId,
      notificationLevel: input.notificationLevel,
      archived: input.archived,
      markUnread: input.markUnread,
      markRead: input.markRead,
      readSequence: input.readSequence,
    })
    return NextResponse.json({ participant, scope: 'self' })
  } catch (_error) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
