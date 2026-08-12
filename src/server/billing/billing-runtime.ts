import 'server-only'

import { createHash } from 'node:crypto'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { UsageEvent, UsageRepository } from '@/server/usage'
import {
  applyMarkupToCents,
  applyMarkupToDollars,
  centsToDollarAmount,
  clampTopUpAmountCents,
  TOP_UP_MAX_AMOUNT_CENTS,
  TOP_UP_MIN_AMOUNT_CENTS,
  TOP_UP_STEP_AMOUNT_CENTS,
} from '@/shared/billing/billing-pricing'
import { maybeAutoTopUpBudget } from '@/server/billing/stripe-billing'
import { logSecurityEvent } from '@/server/observability/security-events'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'

export function isPaidPlan(entitlements: Pick<Entitlements, 'tier' | 'planKind'>): boolean {
  if (entitlements.planKind) return entitlements.planKind === 'paid'
  return entitlements.tier !== 'free'
}

export function canUsePaidBudgetFeatures(entitlements: Pick<
  Entitlements,
  'tier' | 'planKind' | 'creditsUsed' | 'creditsTotal' | 'budgetUsedCents' | 'budgetTotalCents' | 'budgetRemainingCents'
>): boolean {
  return isPaidPlan(entitlements) && getBudgetTotals(entitlements).remainingCents > 0
}

export function usesFreeTierPrivileges(entitlements: Pick<
  Entitlements,
  'tier' | 'planKind' | 'creditsUsed' | 'creditsTotal' | 'budgetUsedCents' | 'budgetTotalCents' | 'budgetRemainingCents'
>): boolean {
  return !canUsePaidBudgetFeatures(entitlements)
}

export function getBudgetTotals(entitlements: Pick<
  Entitlements,
  'creditsUsed' | 'creditsTotal' | 'budgetUsedCents' | 'budgetTotalCents' | 'budgetRemainingCents'
>) {
  const usedCents =
    typeof entitlements.budgetUsedCents === 'number'
      ? entitlements.budgetUsedCents
      : Math.max(0, Math.round(entitlements.creditsUsed ?? 0))
  const totalCents =
    typeof entitlements.budgetTotalCents === 'number'
      ? entitlements.budgetTotalCents
      : Math.max(0, Math.round((entitlements.creditsTotal ?? 0) * 100))
  const remainingCents =
    typeof entitlements.budgetRemainingCents === 'number'
      ? entitlements.budgetRemainingCents
      : Math.max(0, totalCents - usedCents)

  return { usedCents, totalCents, remainingCents }
}

export function billableBudgetCentsFromProviderUsd(providerCostUsd: number): number {
  return applyMarkupToDollars({ providerCostUsd })
}

export function billableBudgetCentsFromProviderCents(providerCostCents: number): number {
  return applyMarkupToCents({ providerCostCents })
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
  workspaceId?: string
  programmaticSubjectId?: string
}) {
  const reservedCents = billableBudgetCentsFromProviderUsd(params.providerCostUsd)
  if (reservedCents <= 0) {
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
    ? {
        entitlements: payerContext.entitlements,
        remainingCents: getBudgetTotals(payerContext.entitlements).remainingCents,
      }
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
      payload: buildInsufficientCreditsPayload(
        budget.entitlements,
        'Your Overlay budget is exhausted. Add budget or enable auto top-up before running this request.',
      ),
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
      payload: buildInsufficientCreditsPayload(
        result.entitlements,
        'Your Overlay budget is exhausted. Add budget or enable auto top-up before running this request.',
      ),
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

export async function getPayerEntitlements(params: {
  fallbackEntitlements?: Entitlements
  programmaticSubjectId?: string
  userId: string
  workspaceId?: string
}): Promise<Entitlements | null> {
  const payer = await resolveBillingPayer(params)
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  const server = getOverlayServerContext()
  if (payer.scope === 'workspace') {
    return await server.appData.repositories.billing.getBillingAccountEntitlementsByServer({
      billingAccountId: payer.billingAccountId,
    }) as Entitlements | null
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
    return {
      entitlements: payerContext.entitlements,
      remainingCents: getBudgetTotals(payerContext.entitlements).remainingCents,
    }
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
    ? await server.appData.repositories.billing.getBillingAccountEntitlementsByServer({
        billingAccountId: payer.billingAccountId,
      }) as Entitlements | null
    : params.entitlements
  if (!entitlements) throw new Error('billing_payer_entitlements_not_found')
  return { entitlements, payer }
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
    costCents: event.cost,
    durationSeconds: event.durationSeconds,
    inputTokens: event.inputTokens,
    kind: event.type,
    modelId: event.modelId,
    occurredAt: event.timestamp,
    outputTokens: event.outputTokens,
  }
}

export async function ensureBudgetAvailable(params: {
  userId: string
  entitlements: Entitlements
  minimumRequiredCents?: number
}) {
  const minimumRequiredCents = Math.max(1, Math.round(params.minimumRequiredCents ?? 1))
  const current = getBudgetTotals(params.entitlements)

  if (!isPaidPlan(params.entitlements) || current.remainingCents >= minimumRequiredCents) {
    return {
      entitlements: params.entitlements,
      remainingCents: current.remainingCents,
      autoTopUpApplied: false,
      autoTopUpReason: 'not_needed',
    } as const
  }

  // Auto top-up reaches Stripe directly rather than through the configured
  // billing provider, so the NoOpBillingProvider substituted when the billing
  // capability is off does not cover it. Without this gate a billing-disabled
  // deployment throws on the missing Stripe secret and fails the whole request.
  if (!(await billingCapabilityEnabled())) {
    return {
      entitlements: params.entitlements,
      remainingCents: current.remainingCents,
      autoTopUpApplied: false,
      autoTopUpReason: 'billing_disabled',
    } as const
  }

  const autoTopUp = await maybeAutoTopUpBudget({
    userId: params.userId,
    minimumRequiredCents,
  }, await billingRepository())

  if (!autoTopUp.applied) {
    return {
      entitlements: params.entitlements,
      remainingCents: current.remainingCents,
      autoTopUpApplied: false,
      autoTopUpReason: autoTopUp.reason,
    } as const
  }

  const refreshed = await refreshEntitlementsForUser(params.userId)
  const nextEntitlements = refreshed ?? params.entitlements
  const nextBudget = getBudgetTotals(nextEntitlements)

  return {
    entitlements: nextEntitlements,
    remainingCents: nextBudget.remainingCents,
    autoTopUpApplied: true,
    autoTopUpAmountCents: autoTopUp.amountCents,
    autoTopUpReason: autoTopUp.reason,
  } as const
}

export function formatBudgetUsage(entitlements: Pick<
  Entitlements,
  'creditsUsed' | 'creditsTotal' | 'budgetUsedCents' | 'budgetTotalCents' | 'budgetRemainingCents'
>) {
  const { usedCents, totalCents, remainingCents } = getBudgetTotals(entitlements)
  const usedPct = totalCents > 0 ? Math.min(100, (usedCents / totalCents) * 100) : 0
  const remainingPct = totalCents > 0 ? Math.max(0, 100 - usedPct) : 0

  return {
    usedCents,
    totalCents,
    remainingCents,
    usedDollars: centsToDollarAmount(usedCents),
    totalDollars: centsToDollarAmount(totalCents),
    remainingDollars: centsToDollarAmount(remainingCents),
    usedPct,
    remainingPct,
  }
}

export function getTopUpPreferenceSnapshot(entitlements: Pick<
  Entitlements,
  'autoTopUpEnabled' | 'autoTopUpAmountCents'
>) {
  const topUpAmountCents = clampTopUpAmountCents(
    typeof entitlements.autoTopUpAmountCents === 'number' && entitlements.autoTopUpAmountCents > 0
      ? entitlements.autoTopUpAmountCents
      : TOP_UP_MIN_AMOUNT_CENTS,
  )

  return {
    topUpAmountCents,
    autoTopUpEnabled: Boolean(entitlements.autoTopUpEnabled),
    topUpMinAmountCents: TOP_UP_MIN_AMOUNT_CENTS,
    topUpMaxAmountCents: TOP_UP_MAX_AMOUNT_CENTS,
    topUpStepAmountCents: TOP_UP_STEP_AMOUNT_CENTS,
    autoTopUpAmountCents: topUpAmountCents,
  }
}

export function buildInsufficientCreditsPayload(
  entitlements: Pick<Entitlements, 'autoTopUpEnabled' | 'autoTopUpAmountCents'>,
  message: string,
) {
  return {
    error: 'insufficient_credits',
    message,
    billingAction: {
      type: 'top_up',
      ...getTopUpPreferenceSnapshot(entitlements),
    },
  } as const
}
