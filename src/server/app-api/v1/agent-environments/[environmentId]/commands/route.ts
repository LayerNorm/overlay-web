import { NextResponse } from 'next/server'
import { OVERLAY_AGENT_PROTOCOL_VERSION } from '@overlay/agent-bridge-protocol'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'
import { emptyBody, enforceAgentHostRateLimit } from '../../host-security'

export async function GET(request: Request, context: { params: Promise<Record<string, string | string[]>> }) {
  try {
    const limited = await enforceAgentHostRateLimit(request, 'commands', 120)
    if (limited) return limited
    const environmentId = await environmentIdFrom(context)
    const service = getOverlayServerContext().connectedAgentControlPlane
    const auth = await service.authenticateHostRequest({
      request, environmentId, requiredMethod: 'agent:commands:poll', rawBody: emptyBody(),
    })
    const requestedLimit = Number(new URL(request.url).searchParams.get('limit') ?? 20)
    const commands = await service.pollCommands(auth, Number.isFinite(requestedLimit) ? requestedLimit : 20)
    return NextResponse.json({
      protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
      commands,
      retryAfterMs: commands.length === 0 ? 1_000 : undefined,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
