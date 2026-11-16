import { NextResponse } from 'next/server'
import { MAX_LOCAL_TOOL_RESULT_BYTES, OVERLAY_AGENT_PROTOCOL_VERSION } from '@layernorm/overlay-agent-bridge-protocol'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ConnectedAgentControlPlaneError } from '@/server/agents'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../../../shared'
import { enforceAgentHostRateLimit, readAgentHostBody } from '../../../../host-security'
import { withAgentHostRouteTelemetry } from '../../../../host-route-telemetry'

/** A connected machine's answer to one local tool call. */
export async function POST(request: Request, context: { params: Promise<Record<string, string | string[]>> }) {
  return withAgentHostRouteTelemetry('local-tools.result', request, async () => {
    try {
      const limited = await enforceAgentHostRateLimit(request, 'local-tools-result', 600)
      if (limited) return limited
      const environmentId = await environmentIdFrom(context)
      const params = await context.params
      const callId = typeof params.callId === 'string' ? params.callId : ''
      const { rawBody, parsed } = await readAgentHostBody(request, MAX_LOCAL_TOOL_RESULT_BYTES + 64 * 1024)
      const auth = await getOverlayServerContext().connectedAgentControlPlane.authenticateHostRequest({
        request, environmentId, requiredMethod: 'agent:events:write', rawBody,
      })
      if (parsed.callId !== callId) throw new ConnectedAgentControlPlaneError('The result does not match its call', 400, 'call_mismatch')
      const result = await getOverlayServerContext().localComputerService.submitFromHost({
        workspaceId: auth.environment.workspaceId, environmentId: auth.environment.id, body: parsed,
      })
      return NextResponse.json({ protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, ...result }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      return agentEnvironmentErrorResponse(error)
    }
  })
}
