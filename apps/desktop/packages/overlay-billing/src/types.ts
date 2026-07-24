export interface Entitlements {
  tier: 'free' | 'pro' | 'max'
  planKind?: 'free' | 'paid'
  planAmountCents?: number
  creditsUsed: number
  creditsTotal: number
  budgetUsedCents?: number
  budgetTotalCents?: number
  budgetRemainingCents?: number
  autoTopUpEnabled?: boolean
  topUpAmountCents?: number
  autoTopUpAmountCents?: number
  autoTopUpConsentGranted?: boolean
  topUpMinAmountCents?: number
  topUpMaxAmountCents?: number
  topUpStepAmountCents?: number
  dailyUsage: { ask: number; write: number; agent: number }
  dailyLimits?: { ask: number; write: number; agent: number }
  overlayStorageBytesUsed?: number
  overlayStorageBytesLimit?: number
  transcriptionSecondsUsed?: number
  transcriptionSecondsLimit?: number
  localTranscriptionEnabled?: boolean
  resetAt?: string
  billingPeriodEnd?: string
  lastSyncedAt?: number
}

export interface CheckoutArgs {
  userId: string
  email?: string
  kind?: 'paid_plan' | 'budget_topup'
  planAmountCents?: number
  topUpAmountCents?: number
  autoTopUpEnabled?: boolean
  successUrl?: string
  cancelUrl?: string
  returnUrl?: string
  metadata?: Record<string, string | number | boolean | null | undefined>
}

export interface CheckoutResult {
  url: string
  providerSessionId?: string
}

export interface PortalResult {
  url: string
  providerSessionId?: string
}

export interface PortalSessionArgs {
  userId: string
  sessionId?: string
  email?: string
  returnUrl?: string
}

export interface CheckoutSessionVerificationArgs {
  sessionId: string
  userId: string
  kind: 'paid_plan' | 'budget_topup'
  allowLatestCompletedFallback?: boolean
}

export interface CheckoutSessionVerificationResult {
  providerSessionId: string
  providerCustomerId?: string
  providerSubscriptionId?: string
  providerPriceId?: string
  providerQuantity?: number
  status?: string
  mode?: string
  paymentStatus?: string
  planAmountCents?: number
  topUpAmountCents?: number
  autoTopUpEnabled?: boolean
  offSessionConsentAt?: number
  currentPeriodStart?: number
  currentPeriodEnd?: number
  amountTotalCents?: number
  currency?: string
  paymentIntentId?: string
  metadata?: Record<string, string>
}

export type UsageKind =
  | 'ask'
  | 'write'
  | 'agent'
  | 'embedding'
  | 'transcription'
  | 'generation'
  | 'sandbox'

export interface UsageArgs {
  userId: string
  accessToken?: string
  type: UsageKind
  modelId?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  cost: number
  timestamp?: number
}

export interface BillingProvider {
  getEntitlements(userId: string): Promise<Entitlements>
  createCheckoutSession(args: CheckoutArgs): Promise<CheckoutResult>
  createPortalSession(userId: string): Promise<PortalResult>
  createCustomerPortalSession?(args: PortalSessionArgs): Promise<PortalResult>
  verifyCheckoutSession?(args: CheckoutSessionVerificationArgs): Promise<CheckoutSessionVerificationResult>
  recordUsage(args: UsageArgs): Promise<void>
  cancelSubscription?(subscriptionId: string): Promise<void>
}
