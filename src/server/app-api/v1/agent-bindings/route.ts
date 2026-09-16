import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse } from '../agent-environments/shared'

export async function GET(request: Request, context: AppApiRouteContext) {
  try {
    const agentId = new URL(request.url).searchParams.get('agentId')?.trim()
    const bindings = await getOverlayServerContext().connectedAgentControlPlane.listBindings({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      ...(agentId ? { agentId } : {}),
    })
    return NextResponse.json({ bindings }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}

export async function PUT(_request: Request, context: AppApiRouteContext) {
  try {
    const body = context.parsedJson as Partial<{
      agentId: string
      environmentId: string
      adapterId: string
      workingDirectory: string
      model: string
      modelBilling: string
      byokConnectionId: string
    }>
    const modelBilling = string(body.modelBilling)
    const binding = await getOverlayServerContext().connectedAgentControlPlane.upsertBinding({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      agentId: string(body.agentId),
      environmentId: string(body.environmentId),
      adapterId: string(body.adapterId),
      workingDirectory: string(body.workingDirectory),
      ...(string(body.model) ? { model: string(body.model) } : {}),
      ...(modelBilling === 'overlay' || modelBilling === 'byok' ? { modelBilling } : {}),
      ...(string(body.byokConnectionId) ? { byokConnectionId: string(body.byokConnectionId) } : {}),
    })
    return NextResponse.json({ binding })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}

export async function DELETE(request: Request, context: AppApiRouteContext) {
  try {
    const agentId = new URL(request.url).searchParams.get('agentId')?.trim()
    if (!agentId) return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
    const disabled = await getOverlayServerContext().connectedAgentControlPlane.disableBindings({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      agentId,
    })
    return NextResponse.json({ disabled })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}

function string(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
