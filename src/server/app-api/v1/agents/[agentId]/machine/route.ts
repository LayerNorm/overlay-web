import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceAgentServiceError } from '@/server/agents'
import { createRetiredCloudAgentService } from '@/server/agents/cloud/create-retired-cloud-agent-service'
import { agentErrorResponse } from '../../shared'

const NO_STORE = { 'Cache-Control': 'no-store' }

async function gate(context: AppApiRouteContext) {
  const params = await context.params
  const agentId = typeof params.agentId === 'string' ? params.agentId.trim() : ''
  if (!agentId) throw new WorkspaceAgentServiceError('validation', 'Agent ID is required')
  // The agent must be one this person can see in the workspace.
  await getOverlayServerContext().workspaceAgentService.get({
    actorUserId: context.auth.userId, workspaceId: context.workspace.workspace.id, agentId,
  })
  return agentId
}

function failure(error: unknown) {
  return agentErrorResponse(error)
}

/** The agent's Overlay Cloud machine: startup progress, running state, account. */
export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const agentId = await gate(context)
    if (typeof agentId !== 'string') return agentId
    const status = await createRetiredCloudAgentService().status({ workspaceId: context.workspace.workspace.id, agentId })
    return NextResponse.json(status, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

/** Legacy controls are retained as an explicit retirement response for stale clients. */
export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    await gate(context)
    return NextResponse.json({
      error: 'Hosted Overlay Cloud agents are retired. Connect a user-owned Agent Host instead.',
      code: 'hosted_runtime_retired',
    }, { status: 410, headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

/** Revoke access and queue provider cleanup; the lease reaper reports any deletion failure. */
export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    const agentId = await gate(context)
    if (typeof agentId !== 'string') return agentId
    await getOverlayServerContext().workspaceAgentService.requireEditable({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      agentId,
    })
    const result = await createRetiredCloudAgentService().teardown({
      actorUserId: context.auth.userId, workspaceId: context.workspace.workspace.id, agentId,
    })
    return NextResponse.json({
      revoked: true,
      cleanupPending: result.cleanupPending,
      ...(result.cleanupPending ? { message: 'Provider cleanup is pending; status remains visible until the lease reaper confirms deletion.' } : {}),
    }, { status: result.cleanupPending ? 202 : 200, headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
