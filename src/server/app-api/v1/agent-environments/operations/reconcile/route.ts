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
    const server = getOverlayServerContext()
    const controlPlane = server.connectedAgentControlPlane
    const supervised = await controlPlane.sweepRemoteRuns()
    const reconciliation = await controlPlane.reconcileSandboxSettlements(100)
    const meter = await server.managedAgentSandboxBilling.meterLeases()
    return NextResponse.json({
      reconciliation,
      supervised: supervised.expiredRunIds.length,
      metered: {
        disabled: meter.disabled === true,
        killed: meter.ticks.filter((tick) => tick.outcome === 'killed').length,
        metered: meter.ticks.filter((tick) => tick.outcome === 'metered').length,
        released: meter.ticks.filter((tick) => tick.outcome === 'released').length,
        errors: meter.ticks.filter((tick) => tick.outcome === 'error').length,
      },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
