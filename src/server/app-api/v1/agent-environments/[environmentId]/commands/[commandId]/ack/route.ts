import { NextResponse } from 'next/server'
import { commandAcknowledgementSchema } from '@layernorm/agent-bridge-protocol'
import { ConnectedAgentControlPlaneError } from '@/server/agents'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../../../shared'
import { enforceAgentHostRateLimit, readAgentHostBody } from '../../../../host-security'

export async function POST(request: Request, context: { params: Promise<Record<string, string | string[]>> }) {
  try {
    const limited = await enforceAgentHostRateLimit(request, 'command-ack', 300)
    if (limited) return limited
    const params = await context.params
    const commandId = typeof params.commandId === 'string' ? params.commandId.trim() : ''
    if (!commandId) throw new ConnectedAgentControlPlaneError('Command id is required', 400, 'command_id_required')
    const environmentId = await environmentIdFrom(context)
    const { rawBody, parsed } = await readAgentHostBody(request)
    const acknowledgement = commandAcknowledgementSchema.parse(parsed)
    if (acknowledgement.commandId !== commandId) {
      throw new ConnectedAgentControlPlaneError('Command id does not match route', 400, 'command_id_mismatch')
    }
    const service = getOverlayServerContext().connectedAgentControlPlane
    const auth = await service.authenticateHostRequest({
      request, environmentId, requiredMethod: 'agent:commands:ack', rawBody,
    })
    await service.acknowledgeCommand(auth, acknowledgement)
    return NextResponse.json({ acknowledged: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
