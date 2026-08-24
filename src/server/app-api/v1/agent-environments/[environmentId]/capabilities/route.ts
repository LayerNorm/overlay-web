import { NextResponse } from 'next/server'
import { hostCapabilitiesSchema } from '@overlay/agent-bridge-protocol'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'
import { enforceAgentHostRateLimit, readAgentHostBody } from '../../host-security'

export async function PUT(request: Request, context: { params: Promise<Record<string, string | string[]>> }) {
  try {
    const limited = await enforceAgentHostRateLimit(request, 'capabilities', 30)
    if (limited) return limited
    const environmentId = await environmentIdFrom(context)
    const { rawBody, parsed } = await readAgentHostBody(request)
    const service = getOverlayServerContext().connectedAgentControlPlane
    const auth = await service.authenticateHostRequest({
      request, environmentId, requiredMethod: 'agent:capabilities:update', rawBody,
    })
    return NextResponse.json({
      environment: await service.updateCapabilities(auth, hostCapabilitiesSchema.parse(parsed)),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
