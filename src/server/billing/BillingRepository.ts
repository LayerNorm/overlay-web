import 'server-only'

import type { BillingAccountRecord } from '@/shared/billing/billing-account'
import type {
  BillingAccountSpendLimitRecord,
  BillingSpendSubject,
} from '@/shared/billing/billing-payer'
import type {
  BillingBalanceParityReport,
  BillingSubscriptionVerificationRow,
} from '@/shared/billing/billing-account-migration'

export type PersonalBillingBackfillResult = {
  attached: {
    budgetReservations: number
    budgetTopUps: number
    daytonaUsageLedger: number
    subscriptions: number
    tokenUsage: number
    toolInvocations: number
    usageOperations: number
  }
  billingAccountId: string
  complete: boolean
  userId: string
}

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
  stripePriceId?: string
  stripeQuantity?: number
  stripeSubscriptionId?: string
  tier?: 'free' | 'pro' | 'max'
  planKind?: 'free' | 'paid'
  planAmountCents?: number
  status?: 'active' | 'canceled' | 'past_due' | 'trialing'
  autoTopUpEnabled?: boolean
  autoTopUpAmountCents?: number
  offSessionConsentAt?: number
  currentPeriodStart?: number
  currentPeriodEnd?: number
}

export type BillingAccountEntitlementsRecord = BillingEntitlementsRecord & {
  billingAccountId: string
}

export type BudgetTopUpRecord = {
  _id: string
  billingAccountId?: string
  amountCents: number
  source: 'manual' | 'auto'
  status: 'pending' | 'succeeded' | 'failed' | 'canceled'
  stripePaymentIntentId?: string
  createdAt: number
  updatedAt: number
  errorMessage?: string
}

export type AdministrativeUsageRecord = {
  userId: string
  email?: string
  planKind: 'free' | 'paid'
  status?: 'active' | 'canceled' | 'past_due' | 'trialing'
  budgetUsedCents: number
  budgetTotalCents: number
  budgetRemainingCents: number
  allowanceTotalCents?: number
  allowanceUsedCents?: number
  allowancePercentUsed?: number
  topUpBalanceCents?: number
}

export interface BillingRepository {
  backfillPersonalBillingAccountByServer(args: {
    userId: string
  }): Promise<PersonalBillingBackfillResult>
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
  getBillingAccountEntitlementsByServer(args: {
    billingAccountId: string
  }): Promise<BillingAccountEntitlementsRecord | null>
  getBillingAccountSubscriptionByServer(args: {
    billingAccountId: string
  }): Promise<BillingSubscriptionRecord | null>
  getPersonalBillingBalanceParityByServer(args: {
    userId: string
  }): Promise<BillingBalanceParityReport | null>
  listSubscriptionVerificationRowsByServer(args?: {
    limit?: number
  }): Promise<BillingSubscriptionVerificationRow[]>
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
  listAdministrativeUsage(args?: {
    limit?: number
    userId?: string
  }): Promise<AdministrativeUsageRecord[]>
  adjustAdministrativeBudget(args: {
    amountCents: number
    userId: string
  }): Promise<AdministrativeUsageRecord>
  getEntitlementsByServer(args: {
    userId: string
  }): Promise<BillingEntitlementsRecord | null>
  getSubscriptionByUserIdByServer(args: {
    userId: string
  }): Promise<BillingSubscriptionRecord | null>
  getSubscriptionByUserId(args: {
    accessToken: string
    userId: string
  }): Promise<BillingSubscriptionRecord | null>
  updateBillingPreferences(args: {
    autoTopUpEnabled: boolean
    grantOffSessionConsent: boolean
    topUpAmountCents: number
    userId: string
  }): Promise<{ success: boolean; error?: string } | null>
  upsertSubscription(args: Record<string, unknown> & {
    userId: string
  }): Promise<unknown>
  upsertBillingAccountSubscription(args: Record<string, unknown> & {
    billingAccountId: string
  }): Promise<unknown>
  listBudgetTopUpsByServer(args: {
    userId: string
  }): Promise<BudgetTopUpRecord[]>
  recordBudgetTopUp(args: {
    amountCents: number
    source: 'manual' | 'auto'
    status: 'pending' | 'succeeded' | 'failed' | 'canceled'
    stripeCheckoutSessionId?: string
    stripeCustomerId?: string
    stripePaymentIntentId?: string
    errorMessage?: string
    userId: string
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
  reverseTopUp(args: {
    userId: string
    billingAccountId?: string
    stripePaymentIntentId: string
    refundAmountCents: number
    reason: string
  }): Promise<{ reversed: boolean }>
  resolveBillingAccountIdByProviderReference(args: {
    provider: string
    providerCustomerId?: string
    providerSubscriptionId?: string
  }): Promise<string | null>
}
