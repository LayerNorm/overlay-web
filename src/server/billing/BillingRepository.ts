import 'server-only'

import type { BillingAccountRecord } from '@/shared/billing/billing-account'
import type { UsageTotal } from '@/shared/billing/usage-resources'
import type {
  BillingAccountSpendLimitRecord,
  BillingSpendSubject,
} from '@/shared/billing/billing-payer'

export type BillingEntitlementsRecord = {
  billingAccountId?: string
  tier: 'free' | 'pro' | 'max'
  planKind: 'free' | 'paid'
  planAmountCents: number
  status?: 'active' | 'canceled' | 'past_due' | 'trialing'
  budgetUsedCents: number
  budgetTotalCents: number
  budgetRemainingCents: number
  allowanceTotalCents?: number
  allowanceUsedCents?: number
  allowancePercentUsed?: number
  topUpBalanceCents?: number
  autoTopUpEnabled: boolean
  autoTopUpAmountCents: number
  autoTopUpConsentGranted: boolean
  creditsUsed: number
  creditsTotal: number
  dailyUsage?: { ask: number; write: number; agent: number }
  dailyLimits?: { ask: number | string; write: number | string; agent: number | string }
  transcriptionSecondsUsed?: number
  transcriptionSecondsLimit?: number
  localTranscriptionEnabled?: boolean
  overlayStorageBytesUsed?: number
  overlayStorageBytesLimit?: number
  resetAt?: number
  billingPeriodEnd?: string
  lastSyncedAt?: number
}

export type BillingSubscriptionRecord = {
  billingAccountId?: string
  userId?: string
  email?: string
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  tier?: 'free' | 'pro' | 'max'
  planKind?: 'free' | 'paid'
  planAmountCents?: number
  status?: 'active' | 'canceled' | 'past_due' | 'trialing'
  autoTopUpEnabled?: boolean
  autoTopUpAmountCents?: number
  /** Workspace plans: most automatic top-ups may add per billing period. */
  autoTopUpMonthlyLimitCents?: number
  /** Workspace plans: automatic top-ups charged (pending or succeeded) this period. */
  autoTopUpSpentThisPeriodCents?: number
  /** Workspace plans: an automatic top-up is still waiting on Stripe. */
  autoTopUpPending?: boolean
  offSessionConsentAt?: number
  currentPeriodStart?: number
  currentPeriodEnd?: number
}

export type BillingAccountEntitlementsRecord = BillingEntitlementsRecord & {
  billingAccountId: string
}

export interface BillingRepository {
  ensurePersonalBillingAccount(args: {
    userId: string
  }): Promise<BillingAccountRecord>
  ensureWorkspaceBillingAccount(args: {
    primaryBillingContactUserId: string
    workspaceId: string
  }): Promise<BillingAccountRecord>
  getBillingAccountByIdByServer(args: {
    billingAccountId: string
  }): Promise<BillingAccountRecord | null>
  getPersonalBillingAccountByUserIdByServer(args: {
    userId: string
  }): Promise<BillingAccountRecord | null>
  getWorkspaceBillingAccountByWorkspaceIdByServer(args: {
    workspaceId: string
  }): Promise<BillingAccountRecord | null>
  getBillingAccountUsageTotalsByServer(args: {
    billingAccountId: string
    periodStart: number
  }): Promise<{ totals: UsageTotal[]; truncated: boolean }>
  getBillingAccountEntitlementsByServer(args: {
    billingAccountId: string
  }): Promise<BillingAccountEntitlementsRecord | null>
  getBillingAccountSubscriptionByServer(args: {
    billingAccountId: string
  }): Promise<BillingSubscriptionRecord | null>
  getBillingAccountSpendLimitByServer(args: {
    billingAccountId: string
    subject: BillingSpendSubject
  }): Promise<BillingAccountSpendLimitRecord | null>
  upsertBillingAccountSpendLimit(args: {
    billingAccountId: string
    limitCents: number
    periodEnd: number
    periodStart: number
    subject: BillingSpendSubject
  }): Promise<BillingAccountSpendLimitRecord>
  getEntitlementsByServer(args: {
    userId: string
  }): Promise<BillingEntitlementsRecord | null>
  upsertBillingAccountSubscription(args: Record<string, unknown> & {
    billingAccountId: string
  }): Promise<unknown>
  recordBillingAccountTopUp(args: {
    actorUserId: string
    amountCents: number
    billingAccountId: string
    source: 'manual' | 'auto'
    status: 'pending' | 'succeeded' | 'failed' | 'canceled'
    stripeCheckoutSessionId?: string
    stripeCustomerId?: string
    stripePaymentIntentId?: string
    errorMessage?: string
  }): Promise<unknown>
}
