import { NextResponse } from 'next/server'
import { OVERLAY_AGENT_PROTOCOL_VERSION, eventBatchSchema } from '@layernorm/overlay-agent-bridge-protocol'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'
import { enforceAgentHostRateLimit, readAgentHostBody } from '../../host-security'
import { withAgentHostRouteTelemetry } from '../../host-route-telemetry'

export async function POST(request: Request, context: { params: Promise<Record<string, string | string[]>> }) {
  return withAgentHostRouteTelemetry('events.upload', request, async () => {
    try {
      const limited = await enforceAgentHostRateLimit(request, 'events', 300)
      if (limited) return limited
      const environmentId = await environmentIdFrom(context)
      const { rawBody, parsed } = await readAgentHostBody(request)
      const service = getOverlayServerContext().connectedAgentControlPlane
      // Authenticate before validating so a refused batch from a real host can be counted against its run.
      const auth = await service.authenticateHostRequest({
        request, environmentId, requiredMethod: 'agent:events:write', rawBody,
      })
      const checked = eventBatchSchema.safeParse(parsed)
      if (!checked.success) {
        if (typeof parsed.runId === 'string' && parsed.runId.length <= 200) await service.recordRejectedEventBatch(auth, parsed.runId)
        throw checked.error
      }
      const batch = checked.data
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
  })
}
