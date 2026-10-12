import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayRuntimeConfig } from '@/server/config'
import { getOverlayServerContext } from '@/server/bootstrap'
import { WorkspaceAgentServiceError } from '@/server/agents'
import { CloudAgentMachineError } from '@/server/agents/cloud/CloudAgentMachineService'
import { createCloudAgentMachineService } from '@/server/agents/cloud/create-cloud-agent-machine-service'
import { CLOUD_AGENT_ACTIONS } from '@/shared/agents/cloud-agent'
import { agentErrorResponse } from '../../shared'

const NO_STORE = { 'Cache-Control': 'no-store' }
const actionSchema = z.object({ action: z.enum(CLOUD_AGENT_ACTIONS) }).strict()

async function gate(context: AppApiRouteContext) {
  const config = await getOverlayRuntimeConfig()
  if (config.features.overlayCloudEnvironments !== true) {
    return NextResponse.json({ error: 'Overlay Cloud agents are disabled', code: 'capability_disabled' }, { status: 404 })
  }
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
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Choose pause, resume, or restart.', code: 'validation' }, { status: 400, headers: NO_STORE })
  }
  if (error instanceof CloudAgentMachineError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode, headers: NO_STORE })
  }
  return agentErrorResponse(error)
}

/** The agent's Overlay Cloud machine: startup progress, running state, account. */
export async function GET(_request: Request, context: AppApiRouteContext) {
  try {
    const agentId = await gate(context)
    if (typeof agentId !== 'string') return agentId
    const status = await createCloudAgentMachineService().status({ workspaceId: context.workspace.workspace.id, agentId })
    return NextResponse.json(status, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

/** Pause, resume, or restart the machine. */
export async function POST(_request: Request, context: AppApiRouteContext) {
  try {
    const agentId = await gate(context)
    if (typeof agentId !== 'string') return agentId
    const { action } = actionSchema.parse(context.parsedJson)
    await createCloudAgentMachineService().control({ workspaceId: context.workspace.workspace.id, agentId, action })
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

/** Delete the machine and everything on it. */
export async function DELETE(_request: Request, context: AppApiRouteContext) {
  try {
    const agentId = await gate(context)
    if (typeof agentId !== 'string') return agentId
    await createCloudAgentMachineService().teardown({
      actorUserId: context.auth.userId, workspaceId: context.workspace.workspace.id, agentId,
    })
    return NextResponse.json({ deleted: true }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
