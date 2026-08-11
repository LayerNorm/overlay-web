import { DEFAULT_MARKUP_BASIS_POINTS } from './billing-pricing'

export const BILLING_CREDITS_PER_CENT = 10
export const CURRENT_BILLING_ACCOUNT_PRICING_VERSION = 'markup_25_v1' as const
export const CURRENT_BILLING_ACCOUNT_MARKUP_BASIS_POINTS = DEFAULT_MARKUP_BASIS_POINTS

export type BillingAccountScope = 'personal' | 'workspace'
export type BillingAccountStatus = 'active' | 'suspended' | 'closed'
export type BillingAccountPricingVersion = typeof CURRENT_BILLING_ACCOUNT_PRICING_VERSION

export type BillingAccountRecord = {
  billingAccountId: string
  closedAt?: number
  createdAt: number
  markupBasisPoints: number
  pricingVersion: BillingAccountPricingVersion
  primaryBillingContactUserId?: string
  scope: BillingAccountScope
  status: BillingAccountStatus
  updatedAt: number
  userId?: string
  workspaceId?: string
}

export function centsToBillingCredits(cents: number): number {
  if (!Number.isFinite(cents) || cents < 0) {
    throw new Error('Billing cents must be a finite non-negative number')
  }
  return Math.round(cents * BILLING_CREDITS_PER_CENT)
}

export function billingCreditsToCents(credits: number): number {
  if (!Number.isFinite(credits) || credits < 0) {
    throw new Error('Billing credits must be a finite non-negative number')
  }
  return credits / BILLING_CREDITS_PER_CENT
}

export function assertBillingAccountOwnership(args: {
  scope: BillingAccountScope
  userId?: string
  workspaceId?: string
}): void {
  const userId = args.userId?.trim()
  const workspaceId = args.workspaceId?.trim()
  if (args.scope === 'personal' && userId && !workspaceId) return
  if (args.scope === 'workspace' && workspaceId && !userId) return
  throw new Error('billing_account_owner_mismatch')
}
