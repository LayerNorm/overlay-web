import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { agentEnvironmentErrorResponse } from '../../shared'

export async function POST(request: Request) {
  try {
    const supplied = request.headers.get('x-internal-api-secret')?.trim() ?? ''
    const expected = getInternalApiSecret()
    if (!sameSecret(supplied, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const controlPlane = getOverlayServerContext().connectedAgentControlPlane
    const supervised = await controlPlane.sweepRemoteRuns()
    const reconciliation = await controlPlane.reconcileSandboxSettlements(100)
    return NextResponse.json({ reconciliation, supervised: supervised.expiredRunIds.length }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}

function sameSecret(supplied: string, expected: string) {
  if (!supplied || supplied.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
}
