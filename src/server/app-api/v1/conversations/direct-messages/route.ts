import { NextResponse } from 'next/server'
import type { DirectMessageCreateInput } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

export async function POST(_request: Request, context: AppApiRouteContext) {
  const input = context.parsedJson as Partial<DirectMessageCreateInput>
  const principalIds = Array.isArray(input.principalIds)
    ? input.principalIds.filter((value): value is string => typeof value === 'string')
    : []
  if (principalIds.length === 0) {
    return NextResponse.json({ error: 'Choose at least one person' }, { status: 400 })
  }
  try {
    const directMessage = await getOverlayServerContext().appData.repositories
      .conversationCollaboration.createDirectMessage({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        principalIds,
        title: typeof input.title === 'string' ? input.title : undefined,
        sourceConversationId: typeof input.sourceConversationId === 'string'
          ? input.sourceConversationId
          : undefined,
      })
    return NextResponse.json({ directMessage }, { status: directMessage.created ? 201 : 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create the direct message'
    return NextResponse.json({ error: message }, {
      status: message.includes('ACCESS_DENIED') ? 404 : 400,
    })
  }
}
