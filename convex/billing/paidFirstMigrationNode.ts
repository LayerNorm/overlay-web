'use node'

import Stripe from 'stripe'
import { v } from 'convex/values'
import { makeFunctionReference } from 'convex/server'
import type { Doc } from '../_generated/dataModel'
import { internalAction } from '../_generated/server'
import { internal } from '../_generated/api'
import { isPreviewDeployment } from '../lib/preview'
import { configuredPaidInvoiceFunding } from './lib/stripeOverlaySubscription'
import { stripeReferenceId } from '../../packages/overlay-billing/src/paid-invoice'

type Outcome = { billingAccountId: string; status: 'eligible' | 'applied' | 'not_applied' | 'needs_review'; reason?: string }
type Page = { candidates: Doc<'billingAccountSubscriptions'>[]; isDone: boolean; continueCursor: string }
const candidates = makeFunctionReference<'query', { cursor: string | null }, Page>('billing/paidFirstMigration:candidatesInternal')

/** No scheduler and no public endpoint. An operator must confirm the backend and explicitly opt into writes. */
export const backfill = internalAction({
  args: { expectedDeploymentUrl: v.string(), apply: v.optional(v.boolean()), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<{ dryRun: boolean; isDone: boolean; continueCursor: string; outcomes: Outcome[] }> => {
    if (!process.env.CONVEX_CLOUD_URL || args.expectedDeploymentUrl !== process.env.CONVEX_CLOUD_URL) throw new Error('deployment_confirmation_required')
    const key = process.env.VERCEL_ENV === 'production' ? process.env.STRIPE_SECRET_KEY : process.env.DEV_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('stripe_not_configured')
    const stripe = new Stripe(key)
    const page = await ctx.runQuery(candidates, { cursor: args.cursor ?? null })
    const outcomes: Outcome[] = []
    for (const row of page.candidates) {
      const review = (reason: string) => outcomes.push({ billingAccountId: row.billingAccountId, status: 'needs_review', reason })
      if (!row.providerSubscriptionId || !row.providerCustomerId || !row.providerPriceId) { review('missing_provider_reference'); continue }
      let subscription: Stripe.Subscription
      try { subscription = await stripe.subscriptions.retrieve(row.providerSubscriptionId, { expand: ['latest_invoice'] }) }
      catch { review('provider_lookup_failed'); continue }
      if (isPreviewDeployment() && subscription.livemode) { review('live_subscription_in_preview'); continue }
      const item = subscription.items.data[0]
      const invoice = subscription.latest_invoice
      const now = Date.now()
      if (subscription.id !== row.providerSubscriptionId || stripeReferenceId(subscription.customer) !== row.providerCustomerId
        || subscription.status !== 'active' || subscription.items.data.length !== 1 || item?.price.id !== row.providerPriceId
        || item.current_period_start * 1000 !== row.currentPeriodStart || item.current_period_end * 1000 !== row.currentPeriodEnd
        || item.current_period_start * 1000 > now || item.current_period_end * 1000 <= now || !invoice || typeof invoice === 'string') {
        review('subscription_snapshot_mismatch'); continue
      }
      const funding = configuredPaidInvoiceFunding(invoice, { customerId: row.providerCustomerId, subscriptionId: row.providerSubscriptionId })
      if (!funding || funding.amountCents !== row.planAmountCents || funding.paidPeriodStart !== row.currentPeriodStart || funding.paidPeriodEnd !== row.currentPeriodEnd) {
        review('current_period_not_fully_funded'); continue
      }
      if (!args.apply) { outcomes.push({ billingAccountId: row.billingAccountId, status: 'eligible' }); continue }
      try {
        const result: { applied: boolean } = await ctx.runMutation(internal.billing.accountSubscriptions.fundPaidPeriodInternal, {
          billingAccountId: row.billingAccountId, stripeCustomerId: row.providerCustomerId, stripeSubscriptionId: row.providerSubscriptionId,
          paidInvoiceId: funding.paidInvoiceId, paidPeriodStart: funding.paidPeriodStart, paidPeriodEnd: funding.paidPeriodEnd, amountCents: funding.amountCents,
        })
        outcomes.push({ billingAccountId: row.billingAccountId, status: result.applied ? 'applied' : 'not_applied' })
      } catch { review('balance_or_concurrent_state_requires_reconciliation') }
    }
    return { dryRun: !args.apply, isDone: page.isDone, continueCursor: page.continueCursor, outcomes }
  },
})
