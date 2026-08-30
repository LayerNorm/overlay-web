import { NextResponse } from 'next/server'
import { enrollmentRequestSchema } from '@layernorm/agent-bridge-protocol'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentEnvironmentErrorResponse } from '../shared'
import { enforceAgentHostRateLimit, readAgentHostBody } from '../host-security'

export async function POST(request: Request) {
  try {
    const limited = await enforceAgentHostRateLimit(request, 'enroll', 10)
    if (limited) return limited
    const { parsed } = await readAgentHostBody(request)
    const result = await getOverlayServerContext().connectedAgentControlPlane.redeemEnrollment(
      enrollmentRequestSchema.parse(parsed),
    )
    return NextResponse.json(result, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
