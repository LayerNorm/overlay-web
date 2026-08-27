import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getInternalApiSecret, matchesInternalApiSecret } from '@/server/shared/internal-api-secret'
import { agentEnvironmentErrorResponse } from '../../shared'

export async function POST(request: Request) {
  try {
    const supplied = request.headers.get('x-internal-api-secret')?.trim()
    if (!matchesInternalApiSecret(supplied, getInternalApiSecret())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json(await getOverlayServerContext().connectedAgentControlPlane.cleanupArtifacts(100), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
