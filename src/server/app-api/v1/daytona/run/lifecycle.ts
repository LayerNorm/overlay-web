import { logger } from '@/server/observability/logger'
import type { ensureWorkspaceSandbox } from '@/server/ai/sandbox/daytona'
import { accrueWorkspaceSpend } from '@/server/ai/sandbox/daytona'
import { computeDaytonaRuntimeCost, getDaytonaResourceProfile } from '@/server/ai/sandbox/daytona-pricing'
import {
  buildInsufficientCreditsPayload,
  ensureBudgetAvailable,
  getBudgetTotals,
  isPaidPlan,
  markProviderBudgetReconcile,
  releaseProviderBudgetReservation,
  reserveProviderBudget,
} from '@/server/billing/billing-runtime'
import type { Entitlements } from '@/shared/app/app-contracts'

type DaytonaWorkspaceRun = Awaited<ReturnType<typeof ensureWorkspaceSandbox>>

type DaytonaBudgetDeps = {
  ensureBudgetAvailable(params: {
    userId: string
    entitlements: Entitlements
    minimumRequiredCents?: number
  }): Promise<{ entitlements: Entitlements; remainingCents: number }>
  getBudgetTotals: typeof getBudgetTotals
  getEntitlementsByServer(params: { userId: string }): Promise<Entitlements | null>
  isPaidPlan: typeof isPaidPlan
  reserveProviderBudget: typeof reserveProviderBudget
}

type DaytonaMeteringDeps = {
  accrueWorkspaceSpend: typeof accrueWorkspaceSpend
  markProviderBudgetReconcile: typeof markProviderBudgetReconcile
  releaseProviderBudgetReservation: typeof releaseProviderBudgetReservation
}

const defaultBudgetDeps: DaytonaBudgetDeps = {
  ensureBudgetAvailable,
  getBudgetTotals,
  getEntitlementsByServer: async () => null,
  isPaidPlan,
  reserveProviderBudget,
}

const defaultMeteringDeps: DaytonaMeteringDeps = {
  accrueWorkspaceSpend,
  markProviderBudgetReconcile,
  releaseProviderBudgetReservation,
}

export type DaytonaBudgetReservationResult =
  | {
    ok: true
    reservationId: string | null
  }
  | {
    ok: false
    payload: Record<string, unknown>
    status: number
  }

export async function reserveDaytonaRunBudget(params: {
  deps?: Partial<DaytonaBudgetDeps>
  idempotencyKey?: string | null
  maxDurationSeconds: number
  operationId: string
  requestFingerprint: string
  userId: string
}): Promise<DaytonaBudgetReservationResult> {
  const deps = { ...defaultBudgetDeps, ...params.deps }
  let currentEntitlements = await deps.getEntitlementsByServer({
    userId: params.userId,
  })

  if (!currentEntitlements) {
    return {
      ok: false,
      payload: { error: 'Unauthorized', message: 'Could not verify subscription. Try signing out and back in.' },
      status: 401,
    }
  }
  if (!deps.isPaidPlan(currentEntitlements)) {
    return {
      ok: false,
      payload: { error: 'sandbox_not_allowed', message: 'Daytona sandbox execution requires a paid plan.' },
      status: 403,
    }
  }

  let budget = deps.getBudgetTotals(currentEntitlements)
  if (budget.remainingCents <= 0) {
    const autoTopUp = await deps.ensureBudgetAvailable({
      userId: params.userId,
      entitlements: currentEntitlements,
      minimumRequiredCents: 1,
    })
    currentEntitlements = autoTopUp.entitlements
    budget = deps.getBudgetTotals(currentEntitlements)
  }
  if (budget.remainingCents <= 0) {
    return {
      ok: false,
      payload: buildInsufficientCreditsPayload(currentEntitlements, 'No budget remaining. Please top up your account.'),
      status: 402,
    }
  }

  const sandboxReservation = await deps.reserveProviderBudget({
    userId: params.userId,
    entitlements: currentEntitlements,
    idempotencyKey: params.idempotencyKey,
    providerCostUsd: maxDaytonaRuntimeCostUsd(params.maxDurationSeconds),
    kind: 'sandbox',
    modelId: 'daytona/pro',
    operationId: params.operationId,
    requestFingerprint: params.requestFingerprint,
  })
  if (!sandboxReservation.ok) {
    return {
      ok: false,
      payload: { ...sandboxReservation.payload, error: sandboxReservation.code },
      status: sandboxReservation.status,
    }
  }
  return { ok: true, reservationId: sandboxReservation.reservationId }
}

export async function finalizeDaytonaRunMetering(params: {
  deps?: Partial<DaytonaMeteringDeps>
  meteringEndedAt: number | null
  meteringStartedAt: number | null
  reservationId: string | null
  userId: string
  workspaceRun: DaytonaWorkspaceRun | null
}): Promise<void> {
  const deps = { ...defaultMeteringDeps, ...params.deps }
  let reservationId = params.reservationId

  if (
    params.workspaceRun &&
    params.meteringStartedAt != null &&
    params.meteringEndedAt != null &&
    params.meteringEndedAt > params.meteringStartedAt
  ) {
    try {
      const meteringResult = await deps.accrueWorkspaceSpend({
        repository: params.workspaceRun.repository,
        workspace: params.workspaceRun.workspace,
        sandbox: params.workspaceRun.sandbox,
        startedAt: params.meteringStartedAt,
        endedAt: params.meteringEndedAt,
        reason: 'task',
      })
      if (reservationId && meteringResult?.success) {
        await deps.releaseProviderBudgetReservation({
          userId: params.userId,
          reservationId,
          reason: 'daytona_actual_usage_accrued',
        }).catch((_error) => undefined)
        reservationId = null
      }
    } catch (meteringError) {
      logger.error('[Daytona Sandbox] Metering failed:', meteringError)
      if (reservationId) {
        await deps.markProviderBudgetReconcile({
          userId: params.userId,
          reservationId,
          errorMessage: meteringError instanceof Error ? meteringError.message : 'daytona_metering_failed',
        }).catch((_error) => undefined)
        reservationId = null
      }
    }
  }

  if (reservationId) {
    await deps.releaseProviderBudgetReservation({
      userId: params.userId,
      reservationId,
      reason: 'daytona_no_metered_runtime',
    }).catch((_error) => undefined)
  }
}

function maxDaytonaRuntimeCostUsd(maxDurationSeconds: number): number {
  const profile = getDaytonaResourceProfile('pro')
  return computeDaytonaRuntimeCost({
    cpu: profile.cpu,
    memoryGiB: profile.memoryGiB,
    diskGiB: profile.diskGiB,
    elapsedSeconds: maxDurationSeconds,
  }).costUsd
}
