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
} from '@/server/billing/billing-runtime'

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
}

export function createGenerationUsagePolicy(args: {
  repository: ActConversationRepository
  usageRepository: UsageRepository
  runtimeConfig: OverlayRuntimeConfig | null
  unlimitedEntitlements: { getEntitlements(args: { userId: string }): Promise<Entitlements | null> }
}): GenerationUsagePolicy {
  return new BillingGenerationUsagePolicy(args.usageRepository)
}
