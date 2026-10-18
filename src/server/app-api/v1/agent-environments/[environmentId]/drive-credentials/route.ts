import { OVERLAY_AGENT_PROTOCOL_VERSION, driveCredentialsRequestSchema } from '@layernorm/overlay-agent-bridge-protocol'
import { getOverlayServerContext } from '@/server/bootstrap'
import { ConnectedAgentControlPlaneError } from '@/server/agents/ConnectedAgentControlPlaneService'
import { createAgentDriveCredentialService } from '@/server/agents/create-agent-drive-credential-service'
import { connectedAgentDriveEnabled } from '@/server/agents/create-agent-drive-service'
import { driveErrorResponse } from '@/server/agents/agent-drive-http'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'
import { enforceAgentHostRateLimit, readAgentHostBody } from '../../host-security'

/** Device-signed host requests can issue/renew only their persisted run's current drive authority. */
export async function POST(request: Request, context: { params: Promise<Record<string, string | string[]>> }) {
  try {
    if (!connectedAgentDriveEnabled()) throw Error('DRIVE_DISABLED')
    const limited = await enforceAgentHostRateLimit(request, 'drive-credentials', 60)
    if (limited) return limited
    const environmentId = await environmentIdFrom(context)
    const { rawBody, parsed } = await readAgentHostBody(request)
    const auth = await getOverlayServerContext().connectedAgentControlPlane.authenticateHostRequest({
      request, environmentId, requiredMethod: 'agent:drive-credentials', rawBody,
    })
    const { runId, sessionId, execution } = driveCredentialsRequestSchema.parse(parsed)
    const credentials = await createAgentDriveCredentialService().issue({
      workspaceId: auth.credential.workspaceId, environmentId: auth.credential.environmentId,
    }, { runId, sessionId, ...(execution ? { execution } : {}) })
    return Response.json({ protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, ...credentials }, {
      headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch (error) {
    return error instanceof ConnectedAgentControlPlaneError ? agentEnvironmentErrorResponse(error) : driveErrorResponse(error)
  }
}
