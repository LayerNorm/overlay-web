import { NextResponse } from 'next/server'
import type { ChannelCreateInput } from '@overlay/workspace-contracts'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'

export async function GET(_request: Request, context: AppApiRouteContext) {
  const channels = await getOverlayServerContext().appData.repositories
    .conversationCollaboration.listChannels({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
  return NextResponse.json({ channels })
}

export async function POST(_request: Request, context: AppApiRouteContext) {
  const body = context.parsedJson as Partial<ChannelCreateInput>
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Channel name is required' }, { status: 400 })
  if (body.visibility !== 'public' && body.visibility !== 'private') {
    return NextResponse.json({ error: 'Channel visibility is required' }, { status: 400 })
  }
  try {
    const channel = await getOverlayServerContext().appData.repositories
      .conversationCollaboration.createChannel({
        actorUserId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        name,
        visibility: body.visibility,
        topic: typeof body.topic === 'string' ? body.topic : undefined,
        principalIds: Array.isArray(body.principalIds)
          ? body.principalIds.filter((value): value is string => typeof value === 'string')
          : undefined,
      })
    return NextResponse.json({ channel }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create channel'
    return NextResponse.json({ error: message }, {
      status: message.includes('ACCESS_DENIED') ? 403 : message.includes('ALREADY') ? 409 : 400,
    })
  }
}
