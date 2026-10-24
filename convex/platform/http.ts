import { httpRouter, type GenericActionCtx } from 'convex/server'
import { components, internal } from '../_generated/api'
import type { DataModel } from '../_generated/dataModel'
import { registerRoutes } from '@convex-dev/stripe'
import type Stripe from 'stripe'

const http = httpRouter()

async function processBillingEvent(ctx: Pick<GenericActionCtx<DataModel>, 'runMutation'>, event: Stripe.Event) {
  await ctx.runMutation(internal.billing.stripeWebhooks.processEventInternal, { event })
}

registerRoutes(http, components.stripe, {
  webhookPath: '/stripe/webhook',
  events: {
    'customer.subscription.created': processBillingEvent,
    'customer.subscription.updated': processBillingEvent,
    'customer.subscription.deleted': processBillingEvent,
    'invoice.payment_failed': processBillingEvent,
    'payment_intent.succeeded': processBillingEvent,
    'payment_intent.payment_failed': processBillingEvent,
    'payment_intent.canceled': processBillingEvent,
    'checkout.session.completed': processBillingEvent,
  },
  onEvent: async (_ctx, event: Stripe.Event) => {
    console.log(`[Stripe Webhook] Received event: ${event.type}`)
  },
})

export default http
