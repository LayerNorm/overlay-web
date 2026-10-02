import { NextResponse } from 'next/server'
import { OVERLAY_AGENT_PROTOCOL_VERSION, runCredentialsRequestSchema } from '@layernorm/overlay-agent-bridge-protocol'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'
import { enforceAgentHostRateLimit, readAgentHostBody } from '../../host-security'

/** An Overlay Cloud host fetches the provider credentials for one of its active runs. */
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
    const input = runCredentialsRequestSchema.parse(parsed)
    const { env } = await service.issueRunCredentials(auth, input.runId)
    return NextResponse.json({ protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, env }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
