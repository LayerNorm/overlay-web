import { NextResponse } from 'next/server'
import { OVERLAY_AGENT_PROTOCOL_VERSION, eventBatchSchema } from '@overlay/agent-bridge-protocol'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'
import { enforceAgentHostRateLimit, readAgentHostBody } from '../../host-security'

export async function POST(request: Request, context: { params: Promise<Record<string, string | string[]>> }) {
  try {
    const limited = await enforceAgentHostRateLimit(request, 'events', 300)
    if (limited) return limited
    const environmentId = await environmentIdFrom(context)
    const { rawBody, parsed } = await readAgentHostBody(request)
    const batch = eventBatchSchema.parse(parsed)
    const service = getOverlayServerContext().connectedAgentControlPlane
    const auth = await service.authenticateHostRequest({
      request, environmentId, requiredMethod: 'agent:events:write', rawBody,
    })
    const result = await service.applyEvents(auth, batch)
    const acknowledgement = result.accepted
      ? { protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, accepted: true as const, acknowledgedSequence: result.acknowledgedSequence }
      : { protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, accepted: false as const, expectedSequence: result.expectedSequence }
    return NextResponse.json(acknowledgement, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
