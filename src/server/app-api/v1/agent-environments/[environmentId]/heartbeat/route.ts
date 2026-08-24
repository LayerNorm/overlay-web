import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'
import { enforceAgentHostRateLimit, readAgentHostBody } from '../../host-security'

export async function POST(request: Request, context: { params: Promise<Record<string, string | string[]>> }) {
  try {
    const limited = await enforceAgentHostRateLimit(request, 'heartbeat', 120)
    if (limited) return limited
    const environmentId = await environmentIdFrom(context)
    const { rawBody } = await readAgentHostBody(request)
    const service = getOverlayServerContext().connectedAgentControlPlane
    const auth = await service.authenticateHostRequest({
      request, environmentId, requiredMethod: 'agent:heartbeat', rawBody,
    })
    return NextResponse.json({ environment: await service.heartbeat(auth) }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
