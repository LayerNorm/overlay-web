import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { sweepEphemeralSandboxes } from '@/server/ai/sandbox/ephemeral-sweeper'
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
    // Defense in depth: delete `sandbox/run` sandboxes orphaned by aborted
    // requests. Runs already delete themselves; anything swept here is a bug
    // elsewhere, so the count is reported loudly.
    const ephemeralSweep = await sweepEphemeralSandboxes().catch((error) => ({
      swept: [] as string[],
      errors: 1,
      error: error instanceof Error ? error.message : String(error),
    }))
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
      ephemeralSweep: {
        deleted: ephemeralSweep.swept.length,
        errors: ephemeralSweep.errors,
      },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return agentEnvironmentErrorResponse(error)
  }
}
