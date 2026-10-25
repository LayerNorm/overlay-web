import { v } from 'convex/values'
import type Stripe from 'stripe'
import { internal } from '../_generated/api'
import { internalMutation, type MutationCtx } from '../_generated/server'
import { extractPlanFromSubscription, getSubscriptionPeriodMs, mapSubscriptionStatus } from './lib/stripeOverlaySubscription'

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

// Subscriptions started before plans moved to workspaces carry the person in their metadata, not a billing account.
// Their events route to the workspace billing account that holds the subscription.
async function convertedAccountId(
  ctx: Pick<MutationCtx, 'runQuery'>,
  reference: { customer?: unknown; subscription?: unknown },
): Promise<string | undefined> {
  const idOf = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? value.id : undefined
  const stripeCustomerId = idOf(reference.customer)
  const stripeSubscriptionId = idOf(reference.subscription)
  if (!stripeCustomerId && !stripeSubscriptionId) return undefined
  return (await ctx.runQuery(internal.billing.accountSubscriptions.workspaceAccountByProviderReferenceInternal, { stripeCustomerId, stripeSubscriptionId })) ?? undefined
}

// Returns true if this is a new event and handlers should run, false if the
// event is a duplicate / stale replay and handlers must be a no-op.
async function recordAndCheckEvent(
  ctx: Pick<MutationCtx, 'runMutation'>,
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

// Plans belong to workspaces: a subscription is synced to the workspace billing account it belongs to (from its
// metadata, or by subscription/customer id for subscriptions started before plans moved). Anything else is ignored.
async function syncWorkspaceSubscription(
  ctx: Pick<MutationCtx, 'runQuery' | 'runMutation'>,
  event: Stripe.CustomerSubscriptionCreatedEvent | Stripe.CustomerSubscriptionUpdatedEvent | Stripe.CustomerSubscriptionDeletedEvent,
) {
  const subscription = event.data.object
  const billingAccountId = subscription.metadata?.billingAccountId
    ?? await convertedAccountId(ctx, { customer: subscription.customer, subscription: subscription.id })
  if (!billingAccountId) {
    console.warn(`[Stripe Webhook] ${event.type} ${subscription.id} is not a workspace subscription; ignored`)
    return
  }
  const deleted = event.type === 'customer.subscription.deleted'
  const plan = extractPlanFromSubscription(subscription)
  const { currentPeriodStart, currentPeriodEnd } = getSubscriptionPeriodMs(subscription)
  await ctx.runMutation(internal.billing.accountSubscriptions.upsertFromStripeInternal, {
    billingAccountId,
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
    stripePriceId: plan.stripePriceId,
    stripeQuantity: plan.stripeQuantity,
    ...(deleted
      ? { planKind: 'free' as const, planAmountCents: 0, status: 'canceled' as const }
      : {
          planKind: plan.planKind,
          planAmountCents: plan.planAmountCents,
          autoTopUpEnabled: readBooleanMetadata(subscription.metadata?.autoTopUpEnabled),
          autoTopUpAmountCents: readNumberMetadata(subscription.metadata?.topUpAmountCents),
          offSessionConsentAt: readNumberMetadata(subscription.metadata?.offSessionConsentAt),
          status: mapSubscriptionStatus(subscription.status),
        }),
    currentPeriodStart,
    currentPeriodEnd,
    providerEventCreatedAt: event.created * 1000,
  })
}

const handlers = {
    'customer.subscription.created': async (ctx: MutationCtx, event: Stripe.CustomerSubscriptionCreatedEvent) => {
      if (!(await recordAndCheckEvent(ctx, event))) return
      await syncWorkspaceSubscription(ctx, event)
    },

    'customer.subscription.updated': async (ctx: MutationCtx, event: Stripe.CustomerSubscriptionUpdatedEvent) => {
      if (!(await recordAndCheckEvent(ctx, event))) return
      await syncWorkspaceSubscription(ctx, event)
    },

    'customer.subscription.deleted': async (ctx: MutationCtx, event: Stripe.CustomerSubscriptionDeletedEvent) => {
      if (!(await recordAndCheckEvent(ctx, event))) return
      await syncWorkspaceSubscription(ctx, event)
    },

    'invoice.payment_failed': async (ctx: MutationCtx, event: Stripe.InvoicePaymentFailedEvent) => {
      if (!(await recordAndCheckEvent(ctx, event))) return
      const invoice = event.data.object
      const billingAccountId =
        invoice.parent?.subscription_details?.metadata?.billingAccountId ??
        invoice.metadata?.billingAccountId ??
        await convertedAccountId(ctx, {
          customer: invoice.customer,
          subscription: invoice.parent?.subscription_details?.subscription,
        })
      if (!billingAccountId) return
      await ctx.runMutation(internal.billing.accountSubscriptions.upsertFromStripeInternal, {
        billingAccountId,
        status: 'past_due',
        providerEventCreatedAt: event.created * 1000,
      })
    },

    // Automatic workspace top-ups charged off-session: Stripe may finish them after the request (3-D Secure), so the
    // final outcome settles the pending row here (credited on success). `autoTopUpReconcile` is the backstop.
    'payment_intent.succeeded': async (ctx: MutationCtx, event: Stripe.PaymentIntentSucceededEvent) => {
      if (!(await recordAndCheckEvent(ctx, event))) return
      const intent = event.data.object
      if (intent.metadata?.kind !== 'budget_topup' || intent.metadata.source !== 'auto' || !intent.metadata.billingAccountId) return
      await ctx.runMutation(internal.billing.autoTopUpSettlement.settlePendingTopUpInternal, {
        stripePaymentIntentId: intent.id,
        outcome: 'succeeded',
      })
    },

    'payment_intent.payment_failed': async (ctx: MutationCtx, event: Stripe.PaymentIntentPaymentFailedEvent) => {
      if (!(await recordAndCheckEvent(ctx, event))) return
      const intent = event.data.object
      if (intent.metadata?.kind !== 'budget_topup' || intent.metadata.source !== 'auto' || !intent.metadata.billingAccountId) return
      await ctx.runMutation(internal.billing.autoTopUpSettlement.settlePendingTopUpInternal, {
        stripePaymentIntentId: intent.id,
        outcome: 'failed',
        errorMessage: intent.last_payment_error?.message ?? 'payment_failed',
      })
    },

    'payment_intent.canceled': async (ctx: MutationCtx, event: Stripe.PaymentIntentCanceledEvent) => {
      if (!(await recordAndCheckEvent(ctx, event))) return
      const intent = event.data.object
      if (intent.metadata?.kind !== 'budget_topup' || intent.metadata.source !== 'auto' || !intent.metadata.billingAccountId) return
      await ctx.runMutation(internal.billing.autoTopUpSettlement.settlePendingTopUpInternal, {
        stripePaymentIntentId: intent.id,
        outcome: 'canceled',
      })
    },

    'checkout.session.completed': async (ctx: MutationCtx, event: Stripe.CheckoutSessionCompletedEvent) => {
      if (!(await recordAndCheckEvent(ctx, event))) return
      const session = event.data.object
      console.log(`[Stripe Webhook] Checkout completed: ${session.id}, mode: ${session.mode}`)
      if (
        session.metadata?.kind === 'budget_topup'
        && session.payment_status === 'paid'
        && session.metadata.userId
        && session.metadata.billingAccountId
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

        await ctx.runMutation(internal.billing.accountSubscriptions.recordTopUpInternal, {
          actorUserId: session.metadata.userId,
          billingAccountId: session.metadata.billingAccountId,
          amountCents: authoritativeAmountCents,
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
        })
      }
    }
}

// The event marker and all billing writes share one transaction. A failed write
// rolls back the marker too, so Stripe can retry instead of losing the event.
export const processEventInternal = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const event = args.event as Stripe.Event
    switch (event.type) {
      case 'customer.subscription.created':
        await handlers['customer.subscription.created'](ctx, event)
        break
      case 'customer.subscription.updated':
        await handlers['customer.subscription.updated'](ctx, event)
        break
      case 'customer.subscription.deleted':
        await handlers['customer.subscription.deleted'](ctx, event)
        break
      case 'invoice.payment_failed':
        await handlers['invoice.payment_failed'](ctx, event)
        break
      case 'payment_intent.succeeded':
        await handlers['payment_intent.succeeded'](ctx, event)
        break
      case 'payment_intent.payment_failed':
        await handlers['payment_intent.payment_failed'](ctx, event)
        break
      case 'payment_intent.canceled':
        await handlers['payment_intent.canceled'](ctx, event)
        break
      case 'checkout.session.completed':
        await handlers['checkout.session.completed'](ctx, event)
        break
    }
    return null
  },
})
