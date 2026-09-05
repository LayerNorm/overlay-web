export type PersonalPlanId = 'free' | 'starter' | 'pro' | 'max'

export interface Entitlements {
  tier: 'free' | 'pro' | 'max'
  planKind?: 'free' | 'paid'
  planAmountCents?: number
  planId?: PersonalPlanId | null
  planDisplayName?: string
  isLegacyPlan?: boolean
  status?: 'active' | 'canceled' | 'past_due' | 'trialing'
  stripeQuantity?: number
  cancelAtPeriodEnd?: boolean
  creditsUsed: number
  creditsTotal: number
  budgetUsedCents?: number
  budgetTotalCents?: number
  budgetRemainingCents?: number
  allowanceTotalCents?: number
  allowanceUsedCents?: number
  allowancePercentUsed?: number
  topUpBalanceCents?: number
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
  billingAccountId?: string
  workspaceId?: string
  email?: string
  kind?: 'paid_plan' | 'budget_topup'
  planId?: Exclude<PersonalPlanId, 'free'>
  planAmountCents?: number
  topUpAmountCents?: number
  autoTopUpEnabled?: boolean
  successUrl?: string
  cancelUrl?: string
  returnUrl?: string
  metadata?: Record<string, string | number | boolean | null | undefined>
}

export type SubscriptionPlanChangeDirection = 'upgrade' | 'downgrade' | 'same'

export interface SubscriptionPlanChangeArgs {
  userId: string
  providerCustomerId?: string
  providerSubscriptionId: string
  planId: Exclude<PersonalPlanId, 'free'>
  targetAmountCents: number
  targetQuantity: number
  idempotencyKey?: string
}

export interface SubscriptionPlanChangePreview {
  currency: string
  currentAmountCents: number
  currentQuantity: number
  direction: SubscriptionPlanChangeDirection
  effectiveAt: number
  losesLegacyPricing: boolean
  planId: Exclude<PersonalPlanId, 'free'>
  prorationAmountCents: number
  targetAmountCents: number
  targetQuantity: number
}

export interface SubscriptionPlanChangeResult extends SubscriptionPlanChangePreview {
  applied: boolean
  paymentActionRequired: boolean
  scheduled: boolean
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
  billingAccountId?: string
  workspaceId?: string
  sessionId?: string
  email?: string
  returnUrl?: string
}

export interface CheckoutSessionVerificationArgs {
  sessionId: string
  userId: string
  billingAccountId?: string
  workspaceId?: string
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
  cancelAtPeriodEnd?: boolean
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
  previewSubscriptionPlanChange?(args: SubscriptionPlanChangeArgs): Promise<SubscriptionPlanChangePreview>
  changeSubscriptionPlan?(args: SubscriptionPlanChangeArgs): Promise<SubscriptionPlanChangeResult>
  recordUsage(args: UsageArgs): Promise<void>
  cancelSubscription?(subscriptionId: string): Promise<void>
}
