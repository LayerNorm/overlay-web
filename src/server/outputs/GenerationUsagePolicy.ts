import 'server-only'

import type { Entitlements } from '@/shared/app/app-contracts'
import type { AppDataProvider } from '@/server/app-data/capabilities'
import type { OverlayRuntimeConfig } from '@/shared/config'
import type { ActConversationRepository } from '@/server/conversations/ActConversationRepository'
import {
  ensureBudgetAvailable,
  finalizeProviderBudgetReservation,
  markProviderBudgetReconcile,
  releaseProviderBudgetReservation,
  reserveProviderBudget,
  type ProviderSpendKind,
  type ProviderUsageEvent,
} from '@/server/billing/billing-runtime'

type ReservationResult = Awaited<ReturnType<typeof reserveProviderBudget>>

export interface GenerationUsagePolicy {
  readonly mode: 'billing' | 'unlimited'
  getEntitlements(args: { userId: string }): Promise<Entitlements | null>
  ensureBudgetAvailable(args: {
    entitlements: Entitlements
    minimumRequiredCents: number
    userId: string
  }): Promise<{ entitlements: Entitlements; remainingCents: number }>
  reserve(args: {
    entitlements: Entitlements
    kind: ProviderSpendKind
    modelId?: string
    providerCostUsd: number
    userId: string
  }): Promise<ReservationResult>
  finalize(args: {
    actualProviderCostUsd: number
    events?: ProviderUsageEvent[]
    reservationId: string | null | undefined
    userId: string
  }): Promise<unknown>
  release(args: {
    providerWorkStarted?: boolean
    reason?: string
    reservationId: string | null | undefined
    userId: string
  }): Promise<void>
  markForReconcile(args: {
    errorMessage?: string
    reservationId: string | null | undefined
    userId: string
  }): Promise<void>
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

  async reserve(args: {
    entitlements: Entitlements
    kind: ProviderSpendKind
    modelId?: string
    providerCostUsd: number
    userId: string
  }): Promise<ReservationResult> {
    return {
      ok: true,
      reservationId: null,
      reservedCents: 0,
      entitlements: args.entitlements,
    }
  }

  async finalize(): Promise<{ success: true; skipped: true }> {
    return { success: true, skipped: true }
  }

  async release(): Promise<void> {}
  async markForReconcile(): Promise<void> {}
}

export class BillingGenerationUsagePolicy implements GenerationUsagePolicy {
  readonly mode = 'billing' as const

  constructor(private readonly repository: ActConversationRepository) {}

  async getEntitlements(args: { userId: string }): Promise<Entitlements | null> {
    return await this.repository.getEntitlements(args)
  }

  async ensureBudgetAvailable(args: {
    entitlements: Entitlements
    minimumRequiredCents: number
    userId: string
  }) {
    return await ensureBudgetAvailable(args)
  }

  async reserve(args: {
    entitlements: Entitlements
    kind: ProviderSpendKind
    modelId?: string
    providerCostUsd: number
    userId: string
  }): Promise<ReservationResult> {
    return await reserveProviderBudget(args)
  }

  async finalize(args: {
    actualProviderCostUsd: number
    events?: ProviderUsageEvent[]
    reservationId: string | null | undefined
    userId: string
  }): Promise<unknown> {
    if (args.reservationId) return await finalizeProviderBudgetReservation(args)
    return { success: true, skipped: true }
  }

  async release(args: {
    providerWorkStarted?: boolean
    reason?: string
    reservationId: string | null | undefined
    userId: string
  }): Promise<void> {
    if (!args.reservationId) return
    await releaseProviderBudgetReservation(args)
  }

  async markForReconcile(args: {
    errorMessage?: string
    reservationId: string | null | undefined
    userId: string
  }): Promise<void> {
    if (!args.reservationId) return
    await markProviderBudgetReconcile(args)
  }
}

export function createGenerationUsagePolicy(args: {
  appDataProvider: AppDataProvider
  repository: ActConversationRepository
  runtimeConfig: OverlayRuntimeConfig | null
  unlimitedEntitlements: { getEntitlements(args: { userId: string }): Promise<Entitlements | null> }
}): GenerationUsagePolicy {
  if (args.appDataProvider === 'postgres' && args.runtimeConfig?.billing.provider === 'none') {
    return new UnlimitedGenerationUsagePolicy(args.unlimitedEntitlements)
  }
  return new BillingGenerationUsagePolicy(args.repository)
}
