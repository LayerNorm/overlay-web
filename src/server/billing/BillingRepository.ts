import 'server-only'

export type BillingEntitlementsRecord = {
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
  offSessionConsentAt?: number
  currentPeriodStart?: number
  currentPeriodEnd?: number
}

export type BudgetTopUpRecord = {
  _id: string
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
}
