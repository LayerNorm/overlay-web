import 'server-only'

import type Stripe from 'stripe'
import { createHash } from 'node:crypto'
import { quantityToPlanAmountCents } from '@/shared/billing/billing-pricing'
import type { BillingRepository } from './BillingRepository'
import type {
  BillingProviderEventRepository,
  BillingWebhookRepository,
} from './BillingProviderEventRepository'

export class StripeWebhookService {
  constructor(private readonly deps: {
    billing: BillingRepository & BillingWebhookRepository
    events: BillingProviderEventRepository
  }) {}

  async handle(args: { event: Stripe.Event; rawBody: string }): Promise<{
    duplicate: boolean
    handled: boolean
  }> {
    const payloadHash = createHash('sha256').update(args.rawBody).digest('hex')
    const reservation = await this.deps.events.reserve({
      eventId: args.event.id,
      eventType: args.event.type,
      payloadHash,
      provider: 'stripe',
    })
    if (reservation.status === 'duplicate') {
      return { duplicate: true, handled: reservation.processed }
    }

    try {
      const handled = await this.applyEvent(args.event)
      await this.deps.events.markProcessed({ eventId: args.event.id, provider: 'stripe' })
      return { duplicate: false, handled }
    } catch (error) {
      await this.deps.events.markFailed({
        error: error instanceof Error ? error.message : String(error),
        eventId: args.event.id,
        provider: 'stripe',
      })
      throw error
    }
  }

  private async applyEvent(event: Stripe.Event): Promise<boolean> {
    if (event.type === 'checkout.session.completed') {
      return await this.applyCheckout(event.data.object as Stripe.Checkout.Session)
    }
    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      return await this.applySubscription(
        event.data.object as Stripe.Subscription,
        event.type === 'customer.subscription.deleted',
      )
    }
    return false
  }

  private async applyCheckout(session: Stripe.Checkout.Session): Promise<boolean> {
    const metadata = session.metadata ?? {}
    const userId = await this.resolveUserId({
      metadataUserId: metadata.userId,
      providerCustomerId: idValue(session.customer),
      providerSubscriptionId: idValue(session.subscription),
    })
    if (!userId) throw new Error('Stripe checkout event is not linked to an Overlay user')

    if (metadata.kind === 'budget_topup') {
      if (session.payment_status !== 'paid') return false
      const amountCents = positiveInteger(session.amount_total ?? metadata.amountCents)
      if (!amountCents) throw new Error('Stripe top-up event has no positive amount')
      await this.deps.billing.recordBudgetTopUp({
        amountCents,
        source: 'manual',
        status: 'succeeded',
        stripeCheckoutSessionId: session.id,
        stripeCustomerId: idValue(session.customer),
        stripePaymentIntentId: idValue(session.payment_intent),
        userId,
      })
      return true
    }

    if (metadata.kind === 'paid_plan') {
      await this.deps.billing.upsertSubscription({
        userId,
        email: metadata.email ?? session.customer_details?.email ?? undefined,
        stripeCustomerId: idValue(session.customer),
        stripeSubscriptionId: idValue(session.subscription),
        stripePriceId: metadata.stripePriceId,
        stripeQuantity: positiveInteger(metadata.stripeQuantity) ?? 1,
        tier: 'pro',
        planKind: 'paid',
        planVersion: metadata.planVersion ?? 'variable_v2',
        planAmountCents: positiveInteger(metadata.planAmountCents) ?? 0,
        autoTopUpEnabled: metadata.autoTopUpEnabled === 'true',
        autoTopUpAmountCents: positiveInteger(metadata.topUpAmountCents) ?? 0,
        offSessionConsentAt: positiveInteger(metadata.offSessionConsentAt),
        status: 'active',
      })
      return true
    }
    return false
  }

  private async applySubscription(subscription: Stripe.Subscription, deleted: boolean): Promise<boolean> {
    const metadata = subscription.metadata ?? {}
    const customerId = idValue(subscription.customer)
    const userId = await this.resolveUserId({
      metadataUserId: metadata.userId,
      providerCustomerId: customerId,
      providerSubscriptionId: subscription.id,
    })
    if (!userId) throw new Error('Stripe subscription event is not linked to an Overlay user')
    const item = subscription.items.data[0]
    const quantity = item?.quantity ?? positiveInteger(metadata.stripeQuantity) ?? 1
    const periodStart = unixSecondsToMillis(item?.current_period_start)
    const periodEnd = unixSecondsToMillis(item?.current_period_end)
    await this.deps.billing.upsertSubscription({
      userId,
      email: metadata.email,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: item?.price.id,
      stripeQuantity: quantity,
      tier: deleted ? 'free' : 'pro',
      planKind: deleted ? 'free' : 'paid',
      planVersion: metadata.planVersion ?? 'variable_v2',
      planAmountCents: positiveInteger(metadata.planAmountCents) ?? quantityToPlanAmountCents(quantity),
      autoTopUpEnabled: metadata.autoTopUpEnabled === 'true',
      autoTopUpAmountCents: positiveInteger(metadata.topUpAmountCents) ?? 0,
      offSessionConsentAt: positiveInteger(metadata.offSessionConsentAt),
      status: deleted ? 'canceled' : normalizeSubscriptionStatus(subscription.status),
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    })
    return true
  }

  private async resolveUserId(args: {
    metadataUserId?: string
    providerCustomerId?: string
    providerSubscriptionId?: string
  }): Promise<string | null> {
    const metadataUserId = args.metadataUserId?.trim()
    if (metadataUserId) {
      const linked = await this.deps.billing.resolveUserIdByProviderReference({
        provider: 'stripe',
        providerCustomerId: args.providerCustomerId,
        providerSubscriptionId: args.providerSubscriptionId,
      })
      if (linked && linked !== metadataUserId) {
        throw new Error('Stripe provider reference belongs to a different Overlay user')
      }
      return metadataUserId
    }
    return await this.deps.billing.resolveUserIdByProviderReference({
      provider: 'stripe',
      providerCustomerId: args.providerCustomerId,
      providerSubscriptionId: args.providerSubscriptionId,
    })
  }
}

function idValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id
  return undefined
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function unixSecondsToMillis(value: number | undefined): number | undefined {
  return typeof value === 'number' && value > 0 ? value * 1000 : undefined
}

function normalizeSubscriptionStatus(
  status: Stripe.Subscription.Status,
): 'active' | 'canceled' | 'past_due' | 'trialing' {
  if (status === 'canceled') return 'canceled'
  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete' || status === 'incomplete_expired') return 'past_due'
  if (status === 'trialing') return 'trialing'
  return 'active'
}
