import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlayRuntimeConfig } from '@/server/config'
import { CLOUD_AGENT_ADAPTER_IDS } from '@/server/agents/cloud/cloud-agent-machine'
import { CloudAgentMachineError, CloudAgentMachineService } from '@/server/agents/cloud/CloudAgentMachineService'
import { agentEnvironmentErrorResponse } from '../shared'

export const cloudAgentMachineRequestSchema = z.object({
  agentId: z.string().trim().min(1).max(256),
  adapterId: z.enum(CLOUD_AGENT_ADAPTER_IDS),
  size: z.enum(['small', 'default', 'large']).default('default'),
}).strict()

/**
 * Provision an Overlay Cloud machine for an agent: a Boat machine from the
 * Overlay agent image, running Claude Code or Codex behind the Agent Host,
 * enrolled, approved, and bound to the agent. Behind `overlayCloudEnvironments`.
 */
export async function POST(request: Request, context: AppApiRouteContext) {
  try {
    const config = await getOverlayRuntimeConfig()
    if (config.features.overlayCloudEnvironments !== true) {
      return NextResponse.json({ error: 'Overlay Cloud agents are disabled', code: 'capability_disabled' }, { status: 404 })
    }
    const body = cloudAgentMachineRequestSchema.parse(context.parsedJson)
    const server = getOverlayServerContext()
    const service = new CloudAgentMachineService({
      audit: server.auditService,
      controlPlane: server.connectedAgentControlPlane,
      repository: server.appData.repositories.connectedAgents,
    })
    const provisioned = await service.provision({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      agentId: body.agentId,
      adapterId: body.adapterId,
      size: body.size,
      serverUrl: new URL(request.url).origin,
    })
    return NextResponse.json(provisioned, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof CloudAgentMachineError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode, headers: { 'Cache-Control': 'no-store' } })
    }
    return agentEnvironmentErrorResponse(error)
  }
}
