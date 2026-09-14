import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { surfaceActorFrom, surfaceErrorResponse } from '../shared'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const agentId = typeof context.parsedQuery.agentId === 'string'
      ? context.parsedQuery.agentId.trim()
      : ''
    if (!agentId) {
      return NextResponse.json(
        { error: 'agentId is required', code: 'validation_error' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const bindings = await getOverlayServerContext().surfaceService.listBindings({
      actor: surfaceActorFrom(context),
      workspaceId: context.workspace.workspace.id,
      agentId,
    })
    return NextResponse.json({ bindings }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return surfaceErrorResponse(error)
  }
}

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
    const connectionId = typeof body.connectionId === 'string' ? body.connectionId.trim() : ''
    const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : ''
    const channelName = typeof body.channelName === 'string' && body.channelName.trim()
      ? body.channelName.trim()
      : undefined
    if (!agentId || !connectionId || !channelId) {
      return NextResponse.json(
        { error: 'agentId, connectionId, and channelId are required', code: 'validation_error' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const binding = await getOverlayServerContext().surfaceService.createBinding({
      actor: surfaceActorFrom(context),
      workspaceId: context.workspace.workspace.id,
      agentId,
      connectionId,
      channelId,
      channelName,
    })
    return NextResponse.json({ binding }, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return surfaceErrorResponse(error)
  }
}
