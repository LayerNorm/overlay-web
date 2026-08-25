import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlayRuntimeConfig } from '@/server/config'
import { ManagedAgentSandboxError, ManagedAgentSandboxService } from '@/server/agents/ManagedAgentSandboxService'
import { connectedAgentPolicyFor } from '@/server/agents/ConnectedAgentPolicy'
import { agentEnvironmentErrorResponse } from '../shared'

export const maxDuration = 300

export async function POST(request: Request, context: AppApiRouteContext) {
  try {
    const config = await getOverlayRuntimeConfig()
    if (config.features.overlayCloudEnvironments !== true) {
      return NextResponse.json({ error: 'Overlay Cloud environments are disabled', code: 'capability_disabled' }, { status: 404 })
    }
    const server = getOverlayServerContext()
    const service = new ManagedAgentSandboxService({
      audit: server.auditService,
      controlPlane: server.connectedAgentControlPlane,
      repository: server.appData.repositories.connectedAgents,
      policyLimits: async ({ userId, workspaceId }) => {
        const entitlements = await server.chatUsagePolicy.getEntitlements({ userId, workspaceId })
        if (!entitlements) throw new ManagedAgentSandboxError('Could not verify subscription', 401, 'not_entitled')
        return connectedAgentPolicyFor(entitlements)
      },
    })
    const provisioned = await service.provision({
      actorUserId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      serverUrl: new URL(request.url).origin,
    })
    return NextResponse.json(provisioned, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ManagedAgentSandboxError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return agentEnvironmentErrorResponse(error)
  }
}
