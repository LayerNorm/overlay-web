import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getSlackAdapter } from '@/server/surfaces/chat'
import { SurfaceServiceError } from '@/server/surfaces/SurfaceService'
import { surfaceActorFrom, surfaceErrorResponse } from '../shared'

export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    if ('agentId' in context.parsedQuery) throw new SurfaceServiceError('validation', 'Slack bindings are workspace-scoped; omit agentId')
    const actor = surfaceActorFrom(context)
    const workspaceId = context.workspace.workspace.id
    const service = getOverlayServerContext().surfaceService
    const { id: agentId } = await service.resolveWorkspaceChief(workspaceId)
    const [bindings, canBind] = await Promise.all([
      service.listBindings({ actor, workspaceId, agentId }),
      service.canBindAgent({ actor, workspaceId, agentId }),
    ])
    return NextResponse.json({ bindings, canBind }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return surfaceErrorResponse(error)
  }
}

export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson
    const service = getOverlayServerContext().surfaceService
    const actor = surfaceActorFrom(context)
    service.requireManager(actor)
    if ('agentId' in body) throw new SurfaceServiceError('validation', 'The workspace Chief is selected by the server; omit agentId')
    const connectionId = typeof body.connectionId === 'string' ? body.connectionId.trim() : ''
    const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : ''
    const channelName = typeof body.channelName === 'string' && body.channelName.trim()
      ? body.channelName.trim()
      : undefined
    if (!connectionId || !channelId) {
      return NextResponse.json(
        { error: 'connectionId and channelId are required', code: 'validation_error' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const chief = await service.resolveWorkspaceChief(context.workspace.workspace.id)
    await service.requireBindableAgent({ actor, workspaceId: context.workspace.workspace.id, agentId: chief.id })
    const binding = await service.createBinding({
      actor,
      workspaceId: context.workspace.workspace.id,
      agentId: chief.id,
      connectionId,
      channelId,
      channelName,
      adapter: await getSlackAdapter(),
    })
    return NextResponse.json({ binding }, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return surfaceErrorResponse(error)
  }
}
