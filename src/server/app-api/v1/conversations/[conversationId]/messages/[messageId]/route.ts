import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

async function ids(context: AppApiRouteContext) {
  const { conversationId, messageId } = await context.params
  if (typeof conversationId !== 'string' || typeof messageId !== 'string') {
    throw new Error('Conversation and message are required')
  }
  return { conversationId, messageId }
}

export async function PATCH(_request: Request, context: AppApiRouteContext) {
  const content = typeof context.parsedJson.content === 'string'
    ? context.parsedJson.content
    : ''
  if (!content.trim()) return NextResponse.json({ error: 'content is required' }, { status: 400 })
  try {
    const updated = await getOverlayServerContext().appData.repositories
      .conversationCollaboration.editMessage({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        ...await ids(context),
        content,
      })
    return updated
      ? NextResponse.json({ updated: true })
      : NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (_error) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    const deleted = await getOverlayServerContext().appData.repositories
      .conversationCollaboration.deleteMessage({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        ...await ids(context),
      })
    return deleted
      ? NextResponse.json({ deleted: true })
      : NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (_error) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
