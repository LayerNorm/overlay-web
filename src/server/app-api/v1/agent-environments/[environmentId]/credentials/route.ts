import { NextResponse } from 'next/server'
import { initialCredentialRequestSchema } from '@overlay/agent-bridge-protocol'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse, environmentIdFrom } from '../../shared'
import { enforceAgentHostRateLimit, readAgentHostBody } from '../../host-security'

export async function POST(request: Request, context: { params: Promise<Record<string, string | string[]>> }) {
  try {
    const limited = await enforceAgentHostRateLimit(request, 'initial-credential', 30)
    if (limited) return limited
    const { parsed } = await readAgentHostBody(request)
    const input = initialCredentialRequestSchema.parse(parsed)
    const result = await getOverlayServerContext().connectedAgentControlPlane.issueInitialCredential({
      environmentId: await environmentIdFrom(context),
      proofChallenge: input.proofChallenge,
      signature: input.signature,
    })
    return NextResponse.json(result, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
