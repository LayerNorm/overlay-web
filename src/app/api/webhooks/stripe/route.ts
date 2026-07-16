import { NextResponse } from 'next/server'
import { requireOverlayCapability } from '@/server/capabilities'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import { StripeWebhookService } from '@/server/billing/StripeWebhookService'
import type { BillingRepository } from '@/server/billing/BillingRepository'
import type { BillingWebhookRepository } from '@/server/billing/BillingProviderEventRepository'
import {
  constructStripeWebhookEvent,
  type StripeWebhookEvent,
} from '@/server/billing/stripe-webhook-verifier'

export async function POST(request: Request) {
  const disabledCapabilityResponse = await requireOverlayCapability('billing')
  if (disabledCapabilityResponse) return disabledCapabilityResponse

  const context = getOverlayServerContext()
  if (context.appDataCapabilities.provider !== 'postgres') {
    return NextResponse.json(
      { error: 'Hosted Convex deployments must use the Convex Stripe webhook endpoint.' },
      { status: 410 },
    )
  }
  const config = getOverlayRuntimeConfigSync()
  const secretKey = config.billing.stripe.secretKey
  const webhookSecret = config.billing.stripe.webhookSecret
  const signature = request.headers.get('stripe-signature')
  if (!secretKey || !webhookSecret || !signature) {
    return NextResponse.json({ error: 'Stripe webhook is not configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  let event: StripeWebhookEvent
  try {
    event = constructStripeWebhookEvent({ rawBody, secretKey, signature, webhookSecret })
  } catch (_error) {
    return NextResponse.json({ error: 'Invalid Stripe signature' }, { status: 400 })
  }

  const service = new StripeWebhookService({
    billing: context.appData.repositories.billing as BillingRepository & BillingWebhookRepository,
    events: context.appData.repositories.billingEvents,
  })
  const result = await service.handle({ event, rawBody })
  await context.auditService.record({
    action: 'billing.stripe.webhook',
    actorType: 'system',
    metadata: { duplicate: result.duplicate, eventType: event.type, handled: result.handled },
    outcome: 'success',
    resourceId: event.id,
    resourceType: 'billing_provider_event',
  })
  return NextResponse.json({ received: true, ...result })
}
