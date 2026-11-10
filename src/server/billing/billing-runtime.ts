import 'server-only'

import { createHash } from 'node:crypto'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { UsageEvent, UsageRepository } from '@/server/usage'
import {
  applyMarkupToCents,
  applyMarkupToDollars,
} from '@/shared/billing/billing-pricing'
import { configuredUsageMarkupBasisPoints } from '@/server/env/usage-markup'
import { ensureWorkspaceBudgetAvailable } from '@/server/billing/workspace-budget'
import { logSecurityEvent } from '@/server/observability/security-events'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'
import { workspaceBudgetLow, workspaceBudgetStopLineCents } from '@/shared/billing/execution-access'
import type { BillingAccountSpendLimitRecord } from '@/shared/billing/billing-payer'
import { requireWorkspaceExecution } from './WorkspaceExecutionPolicy'
import type { BillingRepository } from './BillingRepository'
import {
  buildInsufficientCreditsPayload,
  ensureBudgetAvailable,
  getBudgetTotals,
  isPaidPlan,
} from './billing-runtime-details'
export {
  buildInsufficientCreditsPayload,
  canUsePaidBudgetFeatures,
  ensureBudgetAvailable,
  formatBudgetUsage,
  getBudgetTotals,
  getTopUpPreferenceSnapshot,
  isPaidPlan,
} from './billing-runtime-details'

export function billableBudgetCentsFromProviderUsd(providerCostUsd: number): number {
  return applyMarkupToDollars({ providerCostUsd, markupBasisPoints: configuredUsageMarkupBasisPoints() })
}

export function billableBudgetCentsFromProviderCents(providerCostCents: number): number {
  return applyMarkupToCents({ providerCostCents, markupBasisPoints: configuredUsageMarkupBasisPoints() })
}

export type ProviderSpendKind =
  | 'ask'
  | 'write'
  | 'agent'
  | 'embedding'
  | 'transcription'
  | 'generation'
  | 'sandbox'

export type ProviderUsageEvent = {
  type: ProviderSpendKind
  modelId?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  countAsRequest?: boolean
  providerCostUsd?: number
  cost: number
  durationSeconds?: number
  timestamp: number
}

export function createBudgetReservationId(prefix = 'provider'): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`
}

export function createRequestBoundBudgetReservationId(params: {
  discriminator?: string
  idempotencyKey: string
  operationId: string
  requestFingerprint: string
  userId: string
  payerDiscriminator?: string
}): string {
  const digest = createHash('sha256')
    .update([
      'overlay-usage-reservation:v1',
      params.userId,
      params.payerDiscriminator ?? '',
      params.operationId,
      params.idempotencyKey,
      params.requestFingerprint,
      params.discriminator ?? '',
    ].join('\n'))
    .digest('hex')
  return `usage_${digest}`
}

export async function reserveProviderBudget(params: {
  userId: string
  entitlements: Entitlements
  idempotencyKey?: string | null
  providerCostUsd: number
  kind: ProviderSpendKind
  modelId?: string
  operationId: string
  requestFingerprint: string
  reservationId?: string
  requireExecution?: typeof requireWorkspaceExecution
  workspaceId?: string
  programmaticSubjectId?: string
}) {
  const execution = await (params.requireExecution ?? requireWorkspaceExecution)({
    userId: params.userId,
    workspaceId: params.workspaceId,
    checkBudget: false,
  })
  const reservedCents = billableBudgetCentsFromProviderUsd(params.providerCostUsd)
  if (!execution.billingEnabled || reservedCents <= 0) {
    return {
      ok: true,
      billingAccountId: null,
      reservationId: null,
      reservedCents: 0,
      entitlements: params.entitlements,
    } as const
  }

  const payerContext = await resolveProviderBillingContext(params)
  const budget = payerContext.payer.scope === 'workspace'
    ? await ensureWorkspaceBudgetAvailable({
        billingAccountId: payerContext.payer.billingAccountId,
        entitlements: payerContext.entitlements,
        minimumRequiredCents: Math.max(1, Math.ceil(reservedCents)),
        userId: params.userId,
        workspaceId: payerContext.payer.workspaceId,
      }, {
        billingEnabled: billingCapabilityEnabled,
        remainingCents: (entitlements) => getBudgetTotals(entitlements).remainingCents,
        repository: billingRepository,
      })
    : await ensureBudgetAvailable({
        userId: params.userId,
        entitlements: payerContext.entitlements,
        minimumRequiredCents: Math.max(1, Math.ceil(reservedCents)),
      })

  if (!isPaidPlan(budget.entitlements) || budget.remainingCents + 0.000001 < reservedCents) {
    logBudgetSecurityEvent('owner_funded_budget_declined', params, {
      requiredCents: reservedCents,
      remainingCents: budget.remainingCents,
    })
    return {
      ok: false,
      status: 402,
      code: 'insufficient_budget',
      payload: {
        ...buildInsufficientCreditsPayload(
        budget.entitlements,
        'Your Overlay budget is exhausted. Add budget or enable auto top-up before running this request.',
        ),
        ...(payerContext.payer.scope === 'workspace' ? {
          resourceStatus: {
            reason: 'autoTopUpStatus' in budget ? budget.autoTopUpStatus : 'pending',
            requiredCents: 'requiredCents' in budget ? budget.requiredCents : Math.max(1, Math.ceil(reservedCents)),
            remainingCents: budget.remainingCents,
            ...('autoTopUpReason' in budget && budget.autoTopUpReason
              ? { topUpReason: budget.autoTopUpReason } : {}),
          },
        } : {}),
      },
    } as const
  }

  const reservationId = params.reservationId ?? (
    params.idempotencyKey
      ? createRequestBoundBudgetReservationId({
          discriminator: `${params.kind}:${params.modelId ?? ''}`,
          payerDiscriminator: payerContext.payer.billingAccountId,
          idempotencyKey: params.idempotencyKey,
          operationId: params.operationId,
          requestFingerprint: params.requestFingerprint,
          userId: params.userId,
        })
      : createBudgetReservationId(params.kind)
  )
  let result
  try {
    const repository = await usageRepository()
    const payer = payerContext.payer
    result = payer.scope === 'workspace'
      ? await repository.reserveWorkspace({
          kind: params.kind,
          modelId: params.modelId,
          operationId: params.operationId,
          payer,
          requestFingerprint: params.requestFingerprint,
          reservationId,
          reservedCents,
          userId: params.userId,
        })
      : await repository.reserve({
      entitlements: budget.entitlements,
      kind: params.kind,
      modelId: params.modelId,
      operationId: params.operationId,
      requestFingerprint: params.requestFingerprint,
      reservationId,
      reservedCents,
      userId: params.userId,
    })
  } catch (error) {
    logBudgetSecurityEvent('usage_reservation_integrity_failure', params, {
      reason: safeReservationErrorCode(error),
    }, 'error')
    throw error
  }
  if (!result.ok) {
    logBudgetSecurityEvent('owner_funded_budget_declined', params, {
      requiredCents: result.requiredCents,
      remainingCents: result.remainingCents,
    })
    return {
      ok: false,
      status: 402,
      code: 'insufficient_budget',
      payload: {
        ...buildInsufficientCreditsPayload(
        result.entitlements,
        'Your Overlay budget is exhausted. Add budget or enable auto top-up before running this request.',
        ),
        resourceStatus: {
          reason: 'insufficient_budget',
          requiredCents: result.requiredCents,
          remainingCents: result.remainingCents,
        },
      },
    } as const
  }
  if (result.replayed || result.status !== 'reserved') {
    logBudgetSecurityEvent('usage_reservation_replay_blocked', params, {
      reservationStatus: result.status,
    })
    return {
      ok: false,
      status: 409,
      code: 'usage_reservation_replay',
      payload: {
        error: 'usage_reservation_replay',
        message: 'This owner-funded operation was already reserved. Retry with a new Idempotency-Key.',
      },
    } as const
  }

  return {
    ok: true,
    billingAccountId: payerContext.payer.billingAccountId,
    reservationId,
    reservedCents,
    entitlements: budget.entitlements,
  } as const
}

export type ProviderBudgetRefusal = {
  ok: false
  status: 402
  code: 'insufficient_budget'
  payload: Record<string, unknown>
}

const BUDGET_LOW_MESSAGE = 'Your workspace has less than 2% of its budget left. Add budget or enable auto top-up before running this request.'
const SPEND_LIMIT_MESSAGE = 'Your spending limit in this workspace is used up. Ask a workspace admin to raise it.'

function spendLimitReached(limit: BillingAccountSpendLimitRecord, now = Date.now()): boolean {
  if (now < limit.periodStart || now >= limit.periodEnd) return true
  return limit.usedCents + limit.reservedCents >= limit.limitCents
}

/**
 * The only check before a paid call. It reads the payer's real balance and refuses only when less than 2% of the
 * budget is left after one automatic top-up to the 2% line, or when an admin's spend limit for this member or program
 * is used up. It never estimates, reserves or holds what the call will cost: charge the actual cost afterwards with
 * `chargeProviderUsage`.
 */
export async function ensureProviderBudgetNotLow(params: {
  userId: string
  entitlements: Entitlements
  kind: ProviderSpendKind
  modelId?: string
  operationId: string
  workspaceId?: string
  programmaticSubjectId?: string
  requireExecution?: typeof requireWorkspaceExecution
}): Promise<{ ok: true; entitlements: Entitlements } | ProviderBudgetRefusal> {
  const execution = await (params.requireExecution ?? requireWorkspaceExecution)({
    userId: params.userId,
    workspaceId: params.workspaceId,
    checkBudget: false,
  })
  if (!execution.billingEnabled) return { ok: true, entitlements: params.entitlements }

  const { entitlements, payer } = await resolveProviderBillingContext(params)
  const totals = getBudgetTotals(entitlements)
  const budget = !workspaceBudgetLow(totals)
    ? { entitlements }
    : payer.scope === 'workspace'
      ? await ensureWorkspaceBudgetAvailable({
          billingAccountId: payer.billingAccountId,
          entitlements,
          minimumRequiredCents: workspaceBudgetStopLineCents(totals),
          userId: params.userId,
          workspaceId: payer.workspaceId,
        }, {
          billingEnabled: billingCapabilityEnabled,
          remainingCents: (current) => getBudgetTotals(current).remainingCents,
          repository: billingRepository,
        })
      : await ensureBudgetAvailable({
          userId: params.userId,
          entitlements,
          minimumRequiredCents: workspaceBudgetStopLineCents(totals),
        })
  const after = getBudgetTotals(budget.entitlements)
  if (!isPaidPlan(budget.entitlements) || workspaceBudgetLow(after)) {
    logBudgetSecurityEvent('owner_funded_budget_declined', params, {
      remainingCents: after.remainingCents,
      totalCents: after.totalCents,
    })
    return {
      ok: false,
      status: 402,
      code: 'insufficient_budget',
      payload: {
        ...buildInsufficientCreditsPayload(budget.entitlements, BUDGET_LOW_MESSAGE),
        ...(payer.scope === 'workspace' ? {
          resourceStatus: {
            reason: 'autoTopUpStatus' in budget ? budget.autoTopUpStatus : 'pending',
            requiredCents: workspaceBudgetStopLineCents(after),
            remainingCents: after.remainingCents,
            ...('autoTopUpReason' in budget && budget.autoTopUpReason ? { topUpReason: budget.autoTopUpReason } : {}),
          },
        } : {}),
      },
    }
  }

  if (payer.scope === 'workspace') {
    const limit = await (await billingRepository()).getBillingAccountSpendLimitByServer({
      billingAccountId: payer.billingAccountId,
      subject: payer.subject,
    })
    if (limit && spendLimitReached(limit)) {
      logBudgetSecurityEvent('owner_funded_budget_declined', params, { reason: 'spend_limit_exceeded' })
      return {
        ok: false,
        status: 402,
        code: 'insufficient_budget',
        payload: {
          ...buildInsufficientCreditsPayload(budget.entitlements, SPEND_LIMIT_MESSAGE),
          resourceStatus: {
            reason: 'spend_limit_exceeded',
            remainingCents: Math.max(0, limit.limitCents - limit.usedCents - limit.reservedCents),
          },
        },
      }
    }
  }
  return { ok: true, entitlements: budget.entitlements }
}

/**
 * Charges the actual cost of a finished paid call directly (no reservation). The operation id makes the charge
 * idempotent, so it must be unique per call. `budgetLow` says the payer now has less than 2% left: a loop stops there.
 */
export async function chargeProviderUsage(params: {
  userId: string
  workspaceId?: string
  programmaticSubjectId?: string
  operationId: string
  providerCostUsd: number
  usage: {
    kind: ProviderSpendKind
    modelId?: string
    inputTokens?: number
    outputTokens?: number
    cachedTokens?: number
    countAsRequest?: boolean
    durationSeconds?: number
  }
}): Promise<{ budgetLow: boolean }> {
  if (!Number.isFinite(params.providerCostUsd) || params.providerCostUsd < 0) {
    throw new Error('Invalid provider cost.')
  }
  const { kind, ...usage } = params.usage
  const result = await (await usageRepository()).recordBatch({
    userId: params.userId,
    ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    ...(params.programmaticSubjectId ? { programmaticSubjectId: params.programmaticSubjectId } : {}),
    operationId: params.operationId,
    events: [{
      ...usage,
      kind,
      costCents: billableBudgetCentsFromProviderUsd(params.providerCostUsd),
      providerCostUsd: params.providerCostUsd,
      occurredAt: Date.now(),
    }],
  })
  return { budgetLow: result.budgetLow }
}

export async function getPayerEntitlements(params: {
  fallbackEntitlements?: Entitlements
  programmaticSubjectId?: string
  userId: string
  workspaceId?: string
}): Promise<Entitlements | null> {
  const [payer, { getOverlayServerContext }] = await Promise.all([
    resolveBillingPayer(params),
    import('@/server/bootstrap'),
  ])
  const server = getOverlayServerContext()
  if (payer.scope === 'workspace') {
    return await getWorkspaceEntitlementsWithUserStorage({
      billingAccountId: payer.billingAccountId,
      repository: server.appData.repositories.billing,
      userId: params.userId,
    })
  }
  return params.fallbackEntitlements
    ?? await server.appData.repositories.usage.getEntitlements({ userId: params.userId })
}

export async function resolveBillingPayer(params: {
  programmaticSubjectId?: string
  userId: string
  workspaceId?: string
}) {
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  const server = getOverlayServerContext()
  return await server.billingPayerResolver.resolve(params)
}

export async function ensurePayerBudgetAvailable(params: {
  entitlements: Entitlements
  minimumRequiredCents?: number
  programmaticSubjectId?: string
  userId: string
  workspaceId?: string
}): Promise<{ entitlements: Entitlements; remainingCents: number }> {
  const payerContext = await resolveProviderBillingContext(params)
  if (payerContext.payer.scope === 'workspace') {
    const { billingAccountId, workspaceId } = payerContext.payer
    const { entitlements } = payerContext
    return await ensureWorkspaceBudgetAvailable({ ...params, billingAccountId, entitlements, workspaceId }, {
      billingEnabled: billingCapabilityEnabled, remainingCents: (e) => getBudgetTotals(e).remainingCents, repository: billingRepository,
    })
  }
  return await ensureBudgetAvailable({
    entitlements: payerContext.entitlements,
    minimumRequiredCents: params.minimumRequiredCents,
    userId: params.userId,
  })
}

async function resolveProviderBillingContext(params: {
  entitlements: Entitlements
  programmaticSubjectId?: string
  userId: string
  workspaceId?: string
}) {
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  const server = getOverlayServerContext()
  const payer = await server.billingPayerResolver.resolve(params)
  const entitlements = payer.scope === 'workspace'
    ? await getWorkspaceEntitlementsWithUserStorage({
        billingAccountId: payer.billingAccountId,
        repository: server.appData.repositories.billing,
        userId: params.userId,
      })
    : params.entitlements
  if (!entitlements) throw new Error('billing_payer_entitlements_not_found')
  return { entitlements, payer }
}

async function getWorkspaceEntitlementsWithUserStorage(args: {
  billingAccountId: string
  repository: BillingRepository
  userId: string
}): Promise<Entitlements | null> {
  const [accountEntitlements, userEntitlements] = await Promise.all([
    args.repository.getBillingAccountEntitlementsByServer({ billingAccountId: args.billingAccountId }),
    args.repository.getEntitlementsByServer({ userId: args.userId }),
  ])
  return accountEntitlements
    ? {
        ...accountEntitlements,
        overlayStorageBytesUsed: userEntitlements?.overlayStorageBytesUsed ?? accountEntitlements.overlayStorageBytesUsed,
        overlayStorageBytesLimit: userEntitlements?.overlayStorageBytesLimit ?? accountEntitlements.overlayStorageBytesLimit,
      } as Entitlements
    : null
}

function logBudgetSecurityEvent(
  type: string,
  params: {
    kind: ProviderSpendKind
    modelId?: string
    operationId: string
    userId: string
  },
  details: Record<string, unknown>,
  level: 'warning' | 'error' = 'warning',
): void {
  logSecurityEvent(type, {
    ...details,
    kind: params.kind,
    modelId: params.modelId?.slice(0, 160),
    operationId: params.operationId.slice(0, 160),
    userHash: hashOperationalIdentifier('security-user:v1', params.userId),
  }, level)
}

function safeReservationErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/reservation_parameter_mismatch|reused with different parameters/.test(message)) {
    return 'reservation_parameter_mismatch'
  }
  if (/reservation_user_mismatch/.test(message)) return 'reservation_user_mismatch'
  if (/insufficient_budget|paid plan required/.test(message)) return 'insufficient_budget'
  return 'reservation_backend_error'
}

export async function finalizeProviderBudgetReservation(params: {
  userId: string
  reservationId: string | null | undefined
  actualProviderCostUsd: number
  events?: ProviderUsageEvent[]
}) {
  if (!params.reservationId) return { success: true, skipped: true } as const
  const actualCents = billableBudgetCentsFromProviderUsd(params.actualProviderCostUsd)
  return await (await usageRepository()).finalize({
    actualCostCents: actualCents,
    events: params.events?.map(toUsageEvent),
    reservationId: params.reservationId,
    userId: params.userId,
  })
}

/** Replaces a settled estimate with the exact provider cost. Applies at most once. */
export async function correctProviderBudgetReservationCost(params: {
  userId: string
  reservationId: string
  actualProviderCostUsd: number
}) {
  return await (await usageRepository()).correctFinalizedCost({
    actualCostCents: billableBudgetCentsFromProviderUsd(params.actualProviderCostUsd),
    providerCostUsd: params.actualProviderCostUsd,
    reservationId: params.reservationId,
    userId: params.userId,
  })
}

export async function markProviderBudgetStarted(params: {
  userId: string
  reservationId: string | null | undefined
}) {
  if (!params.reservationId) return { success: true, skipped: true } as const
  const result = await (await usageRepository()).markStarted({
    reservationId: params.reservationId,
    userId: params.userId,
  })
  if (result.status !== 'reserved') {
    throw new Error(`usage_reservation_not_startable:${result.status}`)
  }
  return result
}

export async function releaseProviderBudgetReservation(params: {
  userId: string
  reservationId: string | null | undefined
  providerWorkStarted?: boolean
  reason?: string
}) {
  if (!params.reservationId) return { success: true, skipped: true } as const
  return await (await usageRepository()).release({
    providerWorkStarted: params.providerWorkStarted,
    reason: params.reason,
    reservationId: params.reservationId,
    userId: params.userId,
  })
}

export async function markProviderBudgetReconcile(params: {
  userId: string
  reservationId: string | null | undefined
  errorMessage?: string
}) {
  if (!params.reservationId) return { success: true, skipped: true } as const
  return await (await usageRepository()).markForReconcile({
    errorMessage: params.errorMessage,
    reservationId: params.reservationId,
    userId: params.userId,
  })
}

export async function refreshEntitlementsForUser(userId: string): Promise<Entitlements | null> {
  return await (await usageRepository()).getEntitlements({ userId })
}

async function usageRepository(): Promise<UsageRepository> {
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  return getOverlayServerContext().appData.repositories.usage
}

async function billingRepository() {
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  return getOverlayServerContext().appData.repositories.billing
}

async function billingCapabilityEnabled(): Promise<boolean> {
  const { getOverlayCapabilities } = await import('@/server/capabilities')
  return (await getOverlayCapabilities()).billing
}

function toUsageEvent(event: ProviderUsageEvent): UsageEvent {
  return {
    cachedTokens: event.cachedTokens,
    countAsRequest: event.countAsRequest,
    providerCostUsd: event.providerCostUsd,
    costCents: event.cost,
    durationSeconds: event.durationSeconds,
    inputTokens: event.inputTokens,
    kind: event.type,
    modelId: event.modelId,
    occurredAt: event.timestamp,
    outputTokens: event.outputTokens,
  }
}
