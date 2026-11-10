import 'server-only'

import type { Entitlements } from '@/shared/app/app-contracts'
import type { OverlayRuntimeConfig } from '@/shared/config'
import type { ActConversationRepository } from '@/server/conversations/ActConversationRepository'
import type { UsageRepository } from '@/server/usage'
import {
  chargeProviderUsage,
  ensurePayerBudgetAvailable,
  ensureProviderBudgetNotLow,
  getPayerEntitlements,
  finalizeProviderBudgetReservation,
  markProviderBudgetStarted,
  markProviderBudgetReconcile,
  releaseProviderBudgetReservation,
  reserveProviderBudget,
  type ProviderSpendKind,
  type ProviderUsageEvent,
} from '@/server/billing/billing-runtime'

type ReservationResult = Awaited<ReturnType<typeof reserveProviderBudget>>
type BudgetCheckArgs = Parameters<typeof ensureProviderBudgetNotLow>[0]
type BudgetCheckResult = Awaited<ReturnType<typeof ensureProviderBudgetNotLow>>
type ChargeArgs = Parameters<typeof chargeProviderUsage>[0]

export interface GenerationUsagePolicy {
  readonly mode: 'billing' | 'unlimited'
  getEntitlements(args: { userId: string; workspaceId?: string; programmaticSubjectId?: string }): Promise<Entitlements | null>
  ensureBudgetAvailable(args: {
    entitlements: Entitlements
    idempotencyKey?: string | null
    minimumRequiredCents: number
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<{ entitlements: Entitlements; remainingCents: number }>
  /** Before a paid call: refuses only when under 2% of the budget is left (after a top-up) or a spend limit is used up. */
  ensureBudgetNotLow(args: BudgetCheckArgs): Promise<BudgetCheckResult>
  /** After a paid call: charges its actual cost directly. `budgetLow` means take no further steps. */
  charge(args: ChargeArgs): Promise<{ budgetLow: boolean }>
  /** Computers and managed sandboxes only, until their metering stops holding funds. */
  reserve(args: {
    entitlements: Entitlements
    idempotencyKey?: string | null
    kind: ProviderSpendKind
    modelId?: string
    operationId: string
    providerCostUsd: number
    requestFingerprint: string
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<ReservationResult>
  finalize(args: {
    actualProviderCostUsd: number
    events?: ProviderUsageEvent[]
    reservationId: string | null | undefined
    userId: string
  }): ReturnType<typeof finalizeProviderBudgetReservation>
  markStarted(args: {
    reservationId: string | null | undefined
    userId: string
  }): ReturnType<typeof markProviderBudgetStarted>
  release(args: {
    providerWorkStarted?: boolean
    reason?: string
    reservationId: string | null | undefined
    userId: string
  }): ReturnType<typeof releaseProviderBudgetReservation>
  markForReconcile(args: {
    errorMessage?: string
    reservationId: string | null | undefined
    userId: string
  }): ReturnType<typeof markProviderBudgetReconcile>
}

export class UnlimitedGenerationUsagePolicy implements GenerationUsagePolicy {
  readonly mode = 'unlimited' as const

  constructor(private readonly entitlements: { getEntitlements(args: { userId: string }): Promise<Entitlements | null> }) {}

  async getEntitlements(args: { userId: string }): Promise<Entitlements> {
    const entitlements = await this.entitlements.getEntitlements(args)
    if (!entitlements) throw new Error('Unlimited usage policy did not return entitlements')
    return entitlements
  }

  async ensureBudgetAvailable(args: {
    entitlements: Entitlements
    minimumRequiredCents: number
    userId: string
  }) {
    return { entitlements: args.entitlements, remainingCents: Number.MAX_SAFE_INTEGER }
  }

  async ensureBudgetNotLow(args: BudgetCheckArgs): Promise<BudgetCheckResult> {
    return { ok: true, entitlements: args.entitlements }
  }

  async charge(): Promise<{ budgetLow: boolean }> {
    return { budgetLow: false }
  }

  async reserve(args: {
    entitlements: Entitlements
    idempotencyKey?: string | null
    kind: ProviderSpendKind
    modelId?: string
    operationId: string
    providerCostUsd: number
    requestFingerprint: string
    userId: string
  }): Promise<ReservationResult> {
    return {
      ok: true,
      billingAccountId: null,
      reservationId: null,
      reservedCents: 0,
      entitlements: args.entitlements,
    }
  }

  async finalize(): Promise<{ success: true; skipped: true }> {
    return { success: true, skipped: true }
  }
  async markStarted(): ReturnType<typeof markProviderBudgetStarted> {
    return { success: true, skipped: true }
  }

  async release(): ReturnType<typeof releaseProviderBudgetReservation> {
    return { success: true, skipped: true }
  }
  async markForReconcile(): ReturnType<typeof markProviderBudgetReconcile> {
    return { success: true, skipped: true }
  }
}

export class BillingGenerationUsagePolicy implements GenerationUsagePolicy {
  readonly mode = 'billing' as const

  constructor(private readonly repository: UsageRepository) {}

  async getEntitlements(args: { userId: string; workspaceId?: string; programmaticSubjectId?: string }): Promise<Entitlements | null> {
    const personal = await this.repository.getEntitlements({ userId: args.userId })
    return await getPayerEntitlements({ ...args, fallbackEntitlements: personal ?? undefined })
  }

  async ensureBudgetAvailable(args: {
    entitlements: Entitlements
    idempotencyKey?: string | null
    minimumRequiredCents: number
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }) {
    return await ensurePayerBudgetAvailable(args)
  }

  async ensureBudgetNotLow(args: BudgetCheckArgs): Promise<BudgetCheckResult> {
    return await ensureProviderBudgetNotLow(args)
  }

  async charge(args: ChargeArgs): Promise<{ budgetLow: boolean }> {
    return await chargeProviderUsage(args)
  }

  async reserve(args: {
    entitlements: Entitlements
    idempotencyKey?: string | null
    kind: ProviderSpendKind
    modelId?: string
    operationId: string
    providerCostUsd: number
    requestFingerprint: string
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<ReservationResult> {
    return await reserveProviderBudget(args)
  }

  async finalize(args: {
    actualProviderCostUsd: number
    events?: ProviderUsageEvent[]
    reservationId: string | null | undefined
    userId: string
  }): ReturnType<typeof finalizeProviderBudgetReservation> {
    if (args.reservationId) return await finalizeProviderBudgetReservation(args)
    return { success: true, skipped: true }
  }

  async markStarted(args: {
    reservationId: string | null | undefined
    userId: string
  }): ReturnType<typeof markProviderBudgetStarted> {
    if (!args.reservationId) return { success: true, skipped: true }
    return await markProviderBudgetStarted(args)
  }

  async release(args: {
    providerWorkStarted?: boolean
    reason?: string
    reservationId: string | null | undefined
    userId: string
  }): ReturnType<typeof releaseProviderBudgetReservation> {
    if (!args.reservationId) return { success: true, skipped: true }
    return await releaseProviderBudgetReservation(args)
  }

  async markForReconcile(args: {
    errorMessage?: string
    reservationId: string | null | undefined
    userId: string
  }): ReturnType<typeof markProviderBudgetReconcile> {
    if (!args.reservationId) return { success: true, skipped: true }
    return await markProviderBudgetReconcile(args)
  }
}

export function createGenerationUsagePolicy(args: {
  repository: ActConversationRepository
  usageRepository: UsageRepository
  runtimeConfig: OverlayRuntimeConfig | null
  unlimitedEntitlements: { getEntitlements(args: { userId: string }): Promise<Entitlements | null> }
}): GenerationUsagePolicy {
  return new BillingGenerationUsagePolicy(args.usageRepository)
}
