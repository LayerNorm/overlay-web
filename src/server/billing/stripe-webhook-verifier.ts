import 'server-only'

import Stripe from 'stripe'

export type StripeWebhookEvent = Stripe.Event

export function constructStripeWebhookEvent(args: {
  rawBody: string
  secretKey: string
  signature: string
  webhookSecret: string
}): StripeWebhookEvent {
  return new Stripe(args.secretKey).webhooks.constructEvent(
    args.rawBody,
    args.signature,
    args.webhookSecret,
  )
}
