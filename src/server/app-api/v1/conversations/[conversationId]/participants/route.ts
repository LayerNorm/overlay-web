import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

async function conversationId(context: AppApiRouteContext) {
  const value = (await context.params).conversationId
  if (typeof value !== 'string' || !value.trim()) throw new Error('conversationId is required')
  return value.trim()
}

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const participants = await getOverlayServerContext().appData.repositories
      .conversationCollaboration.listParticipants({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        conversationId: await conversationId(context),
      })
    return NextResponse.json({
      participants,
      currentPrincipalId: context.workspace.principal.id,
    })
  } catch (_error) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function POST(_request: Request, context: AppApiRouteContext) {
  const principalId = typeof context.parsedJson.principalId === 'string'
    ? context.parsedJson.principalId.trim()
    : ''
  if (!principalId) return NextResponse.json({ error: 'principalId is required' }, { status: 400 })
  try {
    const participant = await getOverlayServerContext().appData.repositories
      .conversationCollaboration.addParticipant({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        conversationId: await conversationId(context),
        principalId,
      })
    return NextResponse.json({ participant }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not add participant'
    return NextResponse.json({ error: message }, { status: message.includes('REQUIRED') ? 403 : 400 })
  }
}

export async function DELETE(_request: Request, context: AppApiRouteContext) {
  const principalId = typeof context.parsedJson.principalId === 'string'
    ? context.parsedJson.principalId.trim()
    : ''
  if (!principalId) return NextResponse.json({ error: 'principalId is required' }, { status: 400 })
  try {
    const removed = await getOverlayServerContext().appData.repositories
      .conversationCollaboration.removeParticipant({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        conversationId: await conversationId(context),
        principalId,
      })
    return NextResponse.json({ removed })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not remove participant'
    return NextResponse.json({ error: message }, { status: message.includes('REQUIRED') ? 403 : 400 })
  }
}
