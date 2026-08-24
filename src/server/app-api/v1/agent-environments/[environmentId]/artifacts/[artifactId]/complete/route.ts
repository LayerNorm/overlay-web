import { NextResponse } from 'next/server'
import { artifactCompleteRequestSchema } from '@overlay/agent-bridge-protocol'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../../../shared'
import { enforceAgentHostRateLimit, readAgentHostBody } from '../../../../host-security'

export async function POST(request: Request, context: { params: Promise<Record<string, string | string[]>> }) {
  try {
    const limited = await enforceAgentHostRateLimit(request, 'artifact-complete', 60)
    if (limited) return limited
    const params = await context.params
    const environmentId = await environmentIdFrom(context)
    const artifactId = typeof params.artifactId === 'string' ? params.artifactId : ''
    const { rawBody, parsed } = await readAgentHostBody(request)
    const input = artifactCompleteRequestSchema.parse(parsed)
    if (!artifactId || artifactId !== input.uploadReference) return NextResponse.json({ error: 'Artifact scope mismatch' }, { status: 403 })
    const service = getOverlayServerContext().connectedAgentControlPlane
    const auth = await service.authenticateHostRequest({ request, environmentId,
      requiredMethod: 'agent:artifacts:write', rawBody })
    return NextResponse.json(await service.completeArtifactUpload(auth, artifactId), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
