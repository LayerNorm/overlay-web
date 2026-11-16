import { NextResponse } from 'next/server'
import { LOCAL_TOOL_POLL_WAIT_MAX_MS, OVERLAY_AGENT_PROTOCOL_VERSION } from '@layernorm/overlay-agent-bridge-protocol'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'
import { emptyBody, enforceAgentHostRateLimit } from '../../host-security'
import { withAgentHostRouteTelemetry } from '../../host-route-telemetry'

/**
 * Local tools long-poll: a connected machine waits here for Overlay tool calls
 * to run on itself. Authenticated with the host's signed command-poll scope.
 */
export async function GET(request: Request, context: { params: Promise<Record<string, string | string[]>> }) {
  return withAgentHostRouteTelemetry('local-tools.poll', request, async () => {
    try {
      const limited = await enforceAgentHostRateLimit(request, 'local-tools-poll', 240)
      if (limited) return limited
      const environmentId = await environmentIdFrom(context)
      const auth = await getOverlayServerContext().connectedAgentControlPlane.authenticateHostRequest({
        request, environmentId, requiredMethod: 'agent:commands:poll', rawBody: emptyBody(),
      })
      const requested = Number(new URL(request.url).searchParams.get('waitMs') ?? 0)
      const calls = await getOverlayServerContext().localComputerService.pollForHost({
        workspaceId: auth.environment.workspaceId, environmentId: auth.environment.id,
        waitMs: Number.isFinite(requested) ? Math.min(Math.max(requested, 0), LOCAL_TOOL_POLL_WAIT_MAX_MS) : 0,
        signal: request.signal,
      })
      return NextResponse.json({ protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, calls }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      return agentEnvironmentErrorResponse(error)
    }
  })
}
