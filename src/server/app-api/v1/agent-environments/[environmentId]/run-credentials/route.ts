import { NextResponse } from 'next/server'
import { OVERLAY_AGENT_PROTOCOL_VERSION, providerCredentialsRequestSchema } from '@layernorm/overlay-agent-bridge-protocol'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'
import { enforceAgentHostRateLimit, readAgentHostBody } from '../../host-security'

/** Cloud-only, device-signed provider delivery for an active run or idle bound-adapter discovery. */
export async function POST(request: Request, context: { params: Promise<Record<string, string | string[]>> }) {
  try {
    const limited = await enforceAgentHostRateLimit(request, 'run-credentials', 60)
    if (limited) return limited
    const environmentId = await environmentIdFrom(context)
    const { rawBody, parsed } = await readAgentHostBody(request)
    const service = getOverlayServerContext().connectedAgentControlPlane
    const auth = await service.authenticateHostRequest({
      request, environmentId, requiredMethod: 'agent:run-credentials', rawBody,
    })
    const input = providerCredentialsRequestSchema.parse(parsed)
    const { env } = 'runId' in input ? await service.issueRunCredentials(auth, input.runId)
      : await service.issueDiscoveryCredentials(auth, input.adapterId)
    return NextResponse.json({ protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, env }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
