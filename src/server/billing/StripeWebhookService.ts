import 'server-only'

import type Stripe from 'stripe'
import { createHash } from 'node:crypto'
import { quantityToPlanAmountCents } from '@/shared/billing/billing-pricing'
import type { BillingRepository } from './BillingRepository'
import type {
  BillingProviderEventRepository,
  BillingWebhookRepository,
} from './BillingProviderEventRepository'
import type { LifecycleEventPublisher } from '@/server/lifecycle-events'

export class StripeWebhookService {
  constructor(private readonly deps: {
    billing: BillingRepository & BillingWebhookRepository
    events: BillingProviderEventRepository
    lifecycleEvents?: LifecycleEventPublisher
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
      return await this.applyCheckout(event.data.object as Stripe.Checkout.Session, event.id)
    }
    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      return await this.applySubscription(
        event.data.object as Stripe.Subscription,
        event.type === 'customer.subscription.deleted',
        event.created,
        event.id,
      )
    }
    return false
  }

  private async applyCheckout(session: Stripe.Checkout.Session, eventId: string): Promise<boolean> {
    const metadata = session.metadata ?? {}
    const payer = await this.resolvePayer({
      metadataBillingAccountId: metadata.billingAccountId,
      metadataUserId: metadata.userId,
      metadataWorkspaceId: metadata.workspaceId,
      providerCustomerId: idValue(session.customer),
      providerSubscriptionId: idValue(session.subscription),
    })
    if (!payer) throw new Error('Stripe checkout event is not linked to an Overlay billing account')

    if (metadata.kind === 'budget_topup') {
      if (session.payment_status !== 'paid') return false
      const amountCents = positiveInteger(session.amount_total ?? metadata.amountCents)
      if (!amountCents) throw new Error('Stripe top-up event has no positive amount')
      const topUp = {
        amountCents,
        source: 'manual' as const,
        status: 'succeeded' as const,
        stripeCheckoutSessionId: session.id,
        stripeCustomerId: idValue(session.customer),
        stripePaymentIntentId: idValue(session.payment_intent),
      }
      if (payer.scope === 'workspace') {
        await this.deps.billing.recordBillingAccountTopUp({
          ...topUp,
          actorUserId: payer.actorUserId,
          billingAccountId: payer.billingAccountId,
        })
      } else {
        await this.deps.billing.recordBudgetTopUp({ ...topUp, userId: payer.userId })
      }
      await this.publishLifecycleEvent({
        attributes: { provider: 'stripe', source: 'manual' },
        idempotencyKey: `topup.succeeded:stripe:${eventId}`,
        name: 'topup.succeeded',
        resource: { id: session.id, type: 'billing_topup' },
        userId: payer.actorUserId,
      })
      return true
    }

    if (metadata.kind === 'paid_plan') {
      const subscriptionUpdate = {
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
      }
      if (payer.scope === 'workspace') {
        await this.deps.billing.upsertBillingAccountSubscription({
          ...subscriptionUpdate,
          billingAccountId: payer.billingAccountId,
        })
      } else {
        await this.deps.billing.upsertSubscription({ ...subscriptionUpdate, userId: payer.userId })
      }
      await this.publishLifecycleEvent({
        attributes: {
          changeSource: 'provider_webhook',
          planKind: 'paid',
          provider: 'stripe',
          status: 'active',
        },
        idempotencyKey: `subscription.changed:stripe:${eventId}`,
        name: 'subscription.changed',
        resource: { id: idValue(session.subscription) ?? session.id, type: 'subscription' },
        userId: payer.actorUserId,
      })
      return true
    }
    return false
  }

  private async applySubscription(
    subscription: Stripe.Subscription,
    deleted: boolean,
    eventCreatedSeconds: number,
    eventId: string,
  ): Promise<boolean> {
    const metadata = subscription.metadata ?? {}
    const customerId = idValue(subscription.customer)
    const payer = await this.resolvePayer({
      metadataBillingAccountId: metadata.billingAccountId,
      metadataUserId: metadata.userId,
      metadataWorkspaceId: metadata.workspaceId,
      providerCustomerId: customerId,
      providerSubscriptionId: subscription.id,
    })
    if (!payer) throw new Error('Stripe subscription event is not linked to an Overlay billing account')
    const item = subscription.items.data[0]
    const quantity = item?.quantity ?? positiveInteger(metadata.stripeQuantity) ?? 1
    const periodStart = unixSecondsToMillis(item?.current_period_start)
    const periodEnd = unixSecondsToMillis(item?.current_period_end)
    const subscriptionUpdate = {
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
      providerEventCreatedAt: unixSecondsToMillis(eventCreatedSeconds),
    }
    if (payer.scope === 'workspace') {
      await this.deps.billing.upsertBillingAccountSubscription({
        ...subscriptionUpdate,
        billingAccountId: payer.billingAccountId,
      })
    } else {
      await this.deps.billing.upsertSubscription({ ...subscriptionUpdate, userId: payer.userId })
    }
    await this.publishLifecycleEvent({
      attributes: {
        changeSource: 'provider_webhook',
        planKind: deleted ? 'free' : 'paid',
        provider: 'stripe',
        status: deleted ? 'canceled' : normalizeSubscriptionStatus(subscription.status),
      },
      idempotencyKey: `subscription.changed:stripe:${eventId}`,
      name: 'subscription.changed',
      resource: { id: subscription.id, type: 'subscription' },
      userId: payer.actorUserId,
    })
    return true
  }

  private async publishLifecycleEvent(
    event: Parameters<LifecycleEventPublisher['publish']>[0],
  ): Promise<void> {
    await this.deps.lifecycleEvents?.publish(event)
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

  private async resolvePayer(args: {
    metadataBillingAccountId?: string
    metadataUserId?: string
    metadataWorkspaceId?: string
    providerCustomerId?: string
    providerSubscriptionId?: string
  }): Promise<
    | { actorUserId: string; billingAccountId: string; scope: 'workspace' }
    | { actorUserId: string; scope: 'personal'; userId: string }
    | null
  > {
    const linkedAccountId = await this.deps.billing.resolveBillingAccountIdByProviderReference({
      provider: 'stripe',
      providerCustomerId: args.providerCustomerId,
      providerSubscriptionId: args.providerSubscriptionId,
    })
    const metadataAccountId = args.metadataBillingAccountId?.trim()
    const billingAccountId = metadataAccountId || linkedAccountId
    if (metadataAccountId && linkedAccountId && metadataAccountId !== linkedAccountId) {
      throw new Error('Stripe provider reference belongs to a different Overlay billing account')
    }
    if (billingAccountId) {
      const account = await this.deps.billing.getBillingAccountByIdByServer({ billingAccountId })
      if (!account) throw new Error('Stripe billing account does not exist')
      if (account.scope === 'workspace') {
        if (args.metadataWorkspaceId && account.workspaceId !== args.metadataWorkspaceId) {
          throw new Error('Stripe workspace metadata does not match the billing account')
        }
        const actorUserId = args.metadataUserId?.trim()
          || account.primaryBillingContactUserId?.trim()
        if (!actorUserId) throw new Error('Stripe workspace event has no billing actor')
        return { actorUserId, billingAccountId, scope: 'workspace' }
      }
      if (account.userId) {
        return { actorUserId: account.userId, scope: 'personal', userId: account.userId }
      }
    }
    const userId = await this.resolveUserId(args)
    return userId ? { actorUserId: userId, scope: 'personal', userId } : null
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
