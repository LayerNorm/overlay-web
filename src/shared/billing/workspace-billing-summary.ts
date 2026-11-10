import type { WorkspaceBillingSummaryResponse } from '@overlay/workspace-contracts'
import { centsToBillingCredits } from '@/shared/billing/billing-account'
import { autoTopUpFitsLimit } from '@/shared/billing/auto-top-up'
import { workspaceExecutionAccess } from '@/shared/billing/execution-access'
import type { UsageTotal } from '@/shared/billing/usage-resources'
import { workspaceUsageSummary } from './workspace-usage-summary'

/** The plan fields Workspace → Billing reads. Provider customer and subscription IDs are deliberately absent. */
export type WorkspaceBillingPlan = {
  planKind?: 'free' | 'paid'
  planAmountCents?: number
  status?: 'active' | 'canceled' | 'past_due' | 'trialing'
  autoTopUpEnabled?: boolean
  autoTopUpAmountCents?: number
  autoTopUpMonthlyLimitCents?: number
  autoTopUpSpentThisPeriodCents?: number
  currentPeriodStart?: number
  currentPeriodEnd?: number
  paidPeriodStart?: number
  paidPeriodEnd?: number
}

export type WorkspaceBillingBalance = {
  budgetTotalCents: number
  budgetUsedCents: number
  budgetRemainingCents: number
  allowancePercentUsed?: number
  topUpBalanceCents?: number
}

/** The current billing period, or the last 30 days when the plan has no period yet. */
export function billingPeriodStartOf(plan: WorkspaceBillingPlan, now: number): number {
  return plan.currentPeriodStart ?? now - 30 * 24 * 60 * 60 * 1000
}

function autoTopUpSummary(plan: WorkspaceBillingPlan): NonNullable<WorkspaceBillingSummaryResponse['autoTopUp']> {
  const enabled = Boolean(plan.autoTopUpEnabled)
  const amountCents = plan.autoTopUpAmountCents ?? 0
  const spentThisPeriodCents = plan.autoTopUpSpentThisPeriodCents ?? 0
  const monthlyLimitCents = plan.autoTopUpMonthlyLimitCents ?? null
  return {
    enabled,
    amountCents,
    monthlyLimitCents,
    spentThisPeriodCents,
    limitReached: enabled && !autoTopUpFitsLimit({ monthlyLimitCents: monthlyLimitCents ?? undefined, spentThisPeriodCents }, amountCents),
  }
}

/**
 * Workspace → Billing as the person sees it: the plan, the balance in credits, what happens at $0 and the itemized
 * usage of a paid period. Built the same way by the server route and the live Convex query.
 */
export function composeWorkspaceBillingSummary(args: {
  workspaceId: string
  canManage: boolean
  canTopUp: boolean
  billingEnabled: boolean
  storage: { usedBytes: number; limitBytes: number }
  /** Null when the workspace has no wallet yet. */
  account: { status: string; pricingVersion: string } | null
  balance: WorkspaceBillingBalance | null
  plan: WorkspaceBillingPlan | null
  /** The paid period's per-resource totals; only read for paid plans. */
  usageTotals?: { totals: UsageTotal[]; truncated: boolean }
  now: number
}): WorkspaceBillingSummaryResponse {
  const { workspaceId, canManage, canTopUp, storage, account, balance, plan } = args
  if (!account) {
    return {
      workspaceId,
      canManage,
      canTopUp,
      initialized: false,
      pricingVersion: 'markup_25_v1',
      credits: { total: 0, used: 0, remaining: 0, allowancePercentUsed: 0, topUpBalance: 0 },
      subscription: { planKind: 'free', planAmountCents: 0 },
      storage,
      executionAccess: workspaceExecutionAccess({ billingEnabled: args.billingEnabled, remainingCents: 0 }),
    }
  }
  const usedCents = balance?.budgetUsedCents ?? 0
  const remainingCents = balance?.budgetRemainingCents ?? 0
  const periodStart = plan ? billingPeriodStartOf(plan, args.now) : args.now
  return {
    workspaceId,
    canManage,
    canTopUp,
    initialized: true,
    executionAccess: workspaceExecutionAccess({
      billingEnabled: args.billingEnabled,
      accountStatus: account.status,
      subscription: plan,
      remainingCents,
      totalCents: balance?.budgetTotalCents,
      now: args.now,
    }),
    pricingVersion: account.pricingVersion as WorkspaceBillingSummaryResponse['pricingVersion'],
    credits: {
      total: centsToBillingCredits(balance?.budgetTotalCents ?? 0),
      used: centsToBillingCredits(usedCents),
      remaining: centsToBillingCredits(remainingCents),
      allowancePercentUsed: balance?.allowancePercentUsed ?? 0,
      topUpBalance: centsToBillingCredits(balance?.topUpBalanceCents ?? 0),
    },
    subscription: {
      planKind: plan?.planKind ?? 'free',
      planAmountCents: plan?.planAmountCents ?? 0,
      ...(plan?.status ? { status: plan.status } : {}),
      ...(plan?.currentPeriodEnd ? { currentPeriodEnd: plan.currentPeriodEnd } : {}),
    },
    storage,
    ...(plan?.planKind === 'paid'
      ? {
          autoTopUp: autoTopUpSummary(plan),
          usage: workspaceUsageSummary(args.usageTotals ?? { totals: [], truncated: false }, plan, periodStart, usedCents),
        }
      : {}),
  }
}
