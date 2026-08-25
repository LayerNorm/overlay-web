import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../../shared'
import { enforceAgentHostRateLimit, readAgentHostBody } from '../../../host-security'

export async function POST(request: Request, context: { params: Promise<Record<string, string | string[]>> }) {
  try {
    const limited = await enforceAgentHostRateLimit(request, 'credential-refresh', 30)
    if (limited) return limited
    const environmentId = await environmentIdFrom(context)
    const { rawBody } = await readAgentHostBody(request)
    const service = getOverlayServerContext().connectedAgentControlPlane
    const auth = await service.authenticateHostRequest({
      request, environmentId, requiredMethod: 'agent:credentials:refresh', rawBody,
    })
    return NextResponse.json(await service.refreshCredential(auth), {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
