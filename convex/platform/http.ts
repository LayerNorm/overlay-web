import { httpRouter, type GenericActionCtx } from 'convex/server'
import { components, internal } from '../_generated/api'
import type { DataModel } from '../_generated/dataModel'
import { registerRoutes } from '@convex-dev/stripe'
import type Stripe from 'stripe'
import {
  extractPlanFromSubscription,
  extractCustomerInfo,
  getSubscriptionPeriodMs,
  mapSubscriptionStatus,
} from '../billing/lib/stripeOverlaySubscription'

const http = httpRouter()

function readBooleanMetadata(value: string | undefined): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function readNumberMetadata(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

// Returns true if this is a new event and handlers should run, false if the
// event is a duplicate / stale replay and handlers must be a no-op. `ctx` is
// the handler context provided by @convex-dev/stripe.
async function recordAndCheckEvent(
  ctx: Pick<GenericActionCtx<DataModel>, 'runMutation'>,
  event: Stripe.Event,
): Promise<boolean> {
  const result = await ctx.runMutation(internal.billing.subscriptions.recordWebhookEventIfNew, {
    provider: 'stripe',
    eventId: event.id,
    eventType: event.type,
    eventCreatedMs: event.created ? event.created * 1000 : undefined,
  })
  if (!result.accepted) {
    console.warn(`[Stripe Webhook] Skipping event ${event.id} (${event.type}): ${result.reason}`)
    return false
  }
  return true
}

// Register Stripe webhook handler using @convex-dev/stripe component
registerRoutes(http, components.stripe, {
  webhookPath: '/stripe/webhook',
  events: {
    // Sync subscription changes to our custom subscriptions table
    'customer.subscription.created': async (ctx, event: Stripe.CustomerSubscriptionCreatedEvent) => {
      if (!(await recordAndCheckEvent(ctx, event))) return
      const subscription = event.data.object

      const userId = subscription.metadata?.userId
      const billingAccountId = subscription.metadata?.billingAccountId

      if (billingAccountId) {
        const plan = extractPlanFromSubscription(subscription)
        const { currentPeriodStart, currentPeriodEnd } = getSubscriptionPeriodMs(subscription)
        await ctx.runMutation(internal.billing.accountSubscriptions.upsertFromStripeInternal, {
          billingAccountId,
          stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
          stripeSubscriptionId: subscription.id,
          stripePriceId: plan.stripePriceId,
          stripeQuantity: plan.stripeQuantity,
          planKind: plan.planKind,
          planAmountCents: plan.planAmountCents,
          autoTopUpEnabled: readBooleanMetadata(subscription.metadata?.autoTopUpEnabled),
          autoTopUpAmountCents: readNumberMetadata(subscription.metadata?.topUpAmountCents),
          offSessionConsentAt: readNumberMetadata(subscription.metadata?.offSessionConsentAt),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          status: mapSubscriptionStatus(subscription.status),
          currentPeriodStart,
          currentPeriodEnd,
          providerEventCreatedAt: event.created * 1000,
        })
        return
      }

      if (!userId) {
        console.error('[Stripe Webhook] Missing userId in subscription metadata')
        return
      }

      const plan = extractPlanFromSubscription(subscription)

      const customerInfo = extractCustomerInfo(subscription.customer as Stripe.Customer | string)
      const email = subscription.metadata?.email || customerInfo.email
      const name = customerInfo.name

      const { currentPeriodStart, currentPeriodEnd } = getSubscriptionPeriodMs(subscription)

      await ctx.runMutation(internal.billing.subscriptions.upsertFromStripeInternal, {
        userId,
        email,
        name,
        stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
        stripeSubscriptionId: subscription.id,
        stripePriceId: plan.stripePriceId,
        stripeQuantity: plan.stripeQuantity,
        tier: plan.tier,
        planKind: plan.planKind,
        planVersion: plan.planVersion,
        planAmountCents: plan.planAmountCents,
        autoTopUpEnabled: readBooleanMetadata(subscription.metadata?.autoTopUpEnabled),
        autoTopUpAmountCents: readNumberMetadata(subscription.metadata?.topUpAmountCents),
        offSessionConsentAt: readNumberMetadata(subscription.metadata?.offSessionConsentAt),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        status: mapSubscriptionStatus(subscription.status),
        currentPeriodStart,
        currentPeriodEnd
      })

      console.log(`[Stripe Webhook] Created subscription for user ${userId}: tier=${plan.tier}, planKind=${plan.planKind}, planAmountCents=${plan.planAmountCents}, priceId=${plan.stripePriceId}, email=${email}`)
    },

    'customer.subscription.updated': async (ctx, event: Stripe.CustomerSubscriptionUpdatedEvent) => {
      if (!(await recordAndCheckEvent(ctx, event))) return
      const subscription = event.data.object
      const userId = subscription.metadata?.userId
      const billingAccountId = subscription.metadata?.billingAccountId

      if (billingAccountId) {
        const plan = extractPlanFromSubscription(subscription)
        const { currentPeriodStart, currentPeriodEnd } = getSubscriptionPeriodMs(subscription)
        await ctx.runMutation(internal.billing.accountSubscriptions.upsertFromStripeInternal, {
          billingAccountId,
          stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
          stripeSubscriptionId: subscription.id,
          stripePriceId: plan.stripePriceId,
          stripeQuantity: plan.stripeQuantity,
          planKind: plan.planKind,
          planAmountCents: plan.planAmountCents,
          autoTopUpEnabled: readBooleanMetadata(subscription.metadata?.autoTopUpEnabled),
          autoTopUpAmountCents: readNumberMetadata(subscription.metadata?.topUpAmountCents),
          offSessionConsentAt: readNumberMetadata(subscription.metadata?.offSessionConsentAt),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          status: mapSubscriptionStatus(subscription.status),
          currentPeriodStart,
          currentPeriodEnd,
          providerEventCreatedAt: event.created * 1000,
        })
        return
      }

      if (!userId) {
        console.error('[Stripe Webhook] Missing userId in subscription metadata')
        return
      }

      const plan = extractPlanFromSubscription(subscription)

      const customerInfo = extractCustomerInfo(subscription.customer as Stripe.Customer | string)
      const email = subscription.metadata?.email || customerInfo.email
      const name = customerInfo.name

      const { currentPeriodStart, currentPeriodEnd } = getSubscriptionPeriodMs(subscription)

      await ctx.runMutation(internal.billing.subscriptions.upsertFromStripeInternal, {
        userId,
        email,
        name,
        stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
        stripeSubscriptionId: subscription.id,
        stripePriceId: plan.stripePriceId,
        stripeQuantity: plan.stripeQuantity,
        tier: plan.tier,
        planKind: plan.planKind,
        planVersion: plan.planVersion,
        planAmountCents: plan.planAmountCents,
        autoTopUpEnabled: readBooleanMetadata(subscription.metadata?.autoTopUpEnabled),
        autoTopUpAmountCents: readNumberMetadata(subscription.metadata?.topUpAmountCents),
        offSessionConsentAt: readNumberMetadata(subscription.metadata?.offSessionConsentAt),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        status: mapSubscriptionStatus(subscription.status),
        currentPeriodStart,
        currentPeriodEnd
      })

      console.log(`[Stripe Webhook] Updated subscription for user ${userId}: tier=${plan.tier}, planKind=${plan.planKind}, planAmountCents=${plan.planAmountCents}, priceId=${plan.stripePriceId}, email=${email}`)
    },

    'customer.subscription.deleted': async (ctx, event: Stripe.CustomerSubscriptionDeletedEvent) => {
      if (!(await recordAndCheckEvent(ctx, event))) return
      const subscription = event.data.object

      const userId = subscription.metadata?.userId
      const billingAccountId = subscription.metadata?.billingAccountId

      if (billingAccountId) {
        const plan = extractPlanFromSubscription(subscription)
        const { currentPeriodStart, currentPeriodEnd } = getSubscriptionPeriodMs(subscription)
        await ctx.runMutation(internal.billing.accountSubscriptions.upsertFromStripeInternal, {
          billingAccountId,
          stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
          stripeSubscriptionId: subscription.id,
          stripePriceId: plan.stripePriceId,
          stripeQuantity: plan.stripeQuantity,
          planKind: 'free',
          planAmountCents: 0,
          cancelAtPeriodEnd: false,
          status: 'canceled',
          currentPeriodStart,
          currentPeriodEnd,
          providerEventCreatedAt: event.created * 1000,
        })
      } else if (userId) {
        await ctx.runMutation(internal.billing.subscriptions.updateStatus, {
          userId,
          status: 'canceled'
        })
        console.log(`[Stripe Webhook] Canceled subscription for user ${userId}`)
      }
    },

    'invoice.payment_failed': async (ctx, event: Stripe.InvoicePaymentFailedEvent) => {
      if (!(await recordAndCheckEvent(ctx, event))) return
      const invoice = event.data.object

      console.log(`[HTTP] invoice.payment_failed: invoiceId=${invoice.id}`)

      const userId =
        invoice.parent?.subscription_details?.metadata?.userId ??
        invoice.metadata?.userId
      const billingAccountId =
        invoice.parent?.subscription_details?.metadata?.billingAccountId ??
        invoice.metadata?.billingAccountId

      if (billingAccountId) {
        await ctx.runMutation(internal.billing.accountSubscriptions.upsertFromStripeInternal, {
          billingAccountId,
          status: 'past_due',
          providerEventCreatedAt: event.created * 1000,
        })
      } else if (userId) {
        await ctx.runMutation(internal.billing.subscriptions.updateStatus, {
          userId,
          status: 'past_due'
        })
        console.log(`[Stripe Webhook] Marked subscription as past_due for user ${userId}`)
      }
    },

    'checkout.session.completed': async (ctx, event: Stripe.CheckoutSessionCompletedEvent) => {
      if (!(await recordAndCheckEvent(ctx, event))) return
      const session = event.data.object
      console.log(`[Stripe Webhook] Checkout completed: ${session.id}, mode: ${session.mode}`)
      if (
        session.metadata?.kind === 'budget_topup'
        && session.payment_status === 'paid'
        && session.metadata.userId
      ) {
        // Derive the top-up amount from Stripe's authoritative paid total, NOT
        // from client-set metadata. `session.amount_total` is what Stripe
        // actually charged; `metadata.amountCents` is advisory and untrusted.
        const authoritativeAmountCents =
          typeof session.amount_total === 'number' && Number.isFinite(session.amount_total) && session.amount_total > 0
            ? session.amount_total
            : 0

        if (authoritativeAmountCents <= 0) {
          console.error(`[Stripe Webhook] checkout.session.completed ${session.id} has no amount_total; skipping top-up`)
          return
        }

        // Cross-check metadata agrees with the paid amount. If it doesn't,
        // trust Stripe but log it — mismatch indicates either a bug in the
        // checkout flow or an attempted manipulation.
        const metadataAmountCents = Number.parseInt(session.metadata.amountCents ?? '0', 10)
        if (
          Number.isFinite(metadataAmountCents) &&
          metadataAmountCents > 0 &&
          metadataAmountCents !== authoritativeAmountCents
        ) {
          console.error(
            `[Stripe Webhook] top-up amount mismatch for session ${session.id}: ` +
              `metadata=${metadataAmountCents}, amount_total=${authoritativeAmountCents}. Using amount_total.`,
          )
        }

        if (session.metadata.billingAccountId) {
          await ctx.runMutation(internal.billing.accountSubscriptions.recordTopUpInternal, {
            actorUserId: session.metadata.userId,
            billingAccountId: session.metadata.billingAccountId,
            amountCents: authoritativeAmountCents,
            stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
          })
        } else {
          await ctx.runMutation(internal.billing.subscriptions.recordBudgetTopUpInternal, {
            userId: session.metadata.userId,
            amountCents: authoritativeAmountCents,
            source: 'manual',
            stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
            status: 'succeeded',
          })
          await ctx.runMutation(internal.billing.subscriptions.updateBillingPreferencesInternal, {
            userId: session.metadata.userId,
            autoTopUpEnabled: session.metadata.autoTopUpEnabled === 'true',
            topUpAmountCents: authoritativeAmountCents,
            grantOffSessionConsent: session.metadata.autoTopUpEnabled === 'true',
          })
        }
      }
    }
  },
  onEvent: async (_ctx, event: Stripe.Event) => {
    console.log(`[Stripe Webhook] Received event: ${event.type}`)
  }
})

export default http
