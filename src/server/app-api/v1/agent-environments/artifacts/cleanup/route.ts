import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getInternalApiSecret, matchesInternalApiSecret } from '@/server/shared/internal-api-secret'
import { agentEnvironmentErrorResponse } from '../../shared'
import { cleanupAgentDriveVersions } from '@/server/agents/run-agent-drive-version-cleanup'

export async function POST(request: Request) {
  try {
    const supplied = request.headers.get('x-internal-api-secret')?.trim()
    if (!matchesInternalApiSecret(supplied, getInternalApiSecret())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const artifacts = await getOverlayServerContext().connectedAgentControlPlane.cleanupArtifacts(100)
    const driveVersions = await cleanupAgentDriveVersions()
    return NextResponse.json({ ...artifacts, driveVersions }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
