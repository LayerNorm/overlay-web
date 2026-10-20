import { dispatchRemoteRunIntents } from '@/server/agents/remote-agent-run-dispatcher'
import { NextResponse } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getInternalApiSecret, matchesInternalApiSecret } from '@/server/shared/internal-api-secret'
import { createCloudAgentMachineService } from '@/server/agents/cloud/create-cloud-agent-machine-service'
import { logger } from '@/server/observability/logger'
import { agentEnvironmentErrorResponse } from '../../shared'

export async function POST(request: Request) {
  try {
    const supplied = request.headers.get('x-internal-api-secret')?.trim()
    if (!matchesInternalApiSecret(supplied, getInternalApiSecret())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const server = getOverlayServerContext()
    // A machine's idle timer (scheduled by Convex when a run ends) calls this route with one lease to check.
    const idleCheck = await idleCheckFrom(request)
    if (idleCheck) {
      const result = await server.managedAgentSandboxBilling.idleCheck(idleCheck)
      return NextResponse.json({ idleCheck: result }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const controlPlane = server.connectedAgentControlPlane
    const cloudReclaim = Promise.resolve()
      .then(() => createCloudAgentMachineService().reclaimAbandonedProvisions())
      .catch((error) => {
        logger.warn('[operations-reconcile] cloud agent allocation reclaim failed', {
          error: error instanceof Error ? error.name : 'UnknownError',
        })
        return { reclaimed: 0, skipped: 0, failed: 1 }
      })
    const [supervised, reconciliation, meter, lifecycle, cloudReclaimResult] = await Promise.all([
      controlPlane.sweepRemoteRuns(),
      controlPlane.reconcileSandboxSettlements(100),
      server.managedAgentSandboxBilling.meterLeases(),
      dispatchRemoteRunIntents(),
      cloudReclaim,
    ])
    return NextResponse.json({
      reconciliation,
      lifecycle,
      cloudReclaim: cloudReclaimResult,
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

async function idleCheckFrom(request: Request): Promise<{ workspaceId: string; leaseId: string; token: string } | null> {
  const body = await request.json().catch((_error) => null) as { idleCheck?: Record<string, unknown> } | null
  const check = body?.idleCheck
  if (!check) return null
  const { workspaceId, leaseId, token } = check
  if (typeof workspaceId !== 'string' || typeof leaseId !== 'string' || typeof token !== 'string') return null
  return { workspaceId, leaseId, token }
}
