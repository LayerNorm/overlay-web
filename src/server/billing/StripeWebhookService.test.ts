import assert from 'node:assert/strict'
import test from 'node:test'
import type Stripe from 'stripe'
import type { EventBus } from '@overlay/app-core'
import { LifecycleEventPublisher, LIFECYCLE_EVENT_TOPIC } from '@/server/lifecycle-events'
import type { BillingRepository } from './BillingRepository'
import type { BillingProviderEventRepository, BillingWebhookRepository } from './BillingProviderEventRepository'
import { StripeWebhookService } from './StripeWebhookService'

class CapturingEventBus implements EventBus {
  readonly events: Array<{ payload: unknown; topic: string }> = []

  async publish(topic: string, payload: unknown): Promise<void> {
    this.events.push({ topic, payload })
  }

  subscribe(): () => void {
    return () => {}
  }
}

test('StripeWebhookService emits a top-up lifecycle event with identifiers only', async () => {
  const eventBus = new CapturingEventBus()
  const billing = {
    async recordBudgetTopUp() {
      return null
    },
    async resolveUserIdByProviderReference() {
      return 'user_1'
    },
  } as unknown as BillingRepository & BillingWebhookRepository
  const events = {
    async reserve() {
      return { attempt: 1, status: 'acquired' as const }
    },
    async markProcessed() {},
    async markFailed() {},
  } satisfies BillingProviderEventRepository
  const service = new StripeWebhookService({
    billing,
    events,
    lifecycleEvents: new LifecycleEventPublisher({ eventBus }),
  })
  const event = {
    created: 1_700_000_000,
    data: {
      object: {
        amount_total: 1000,
        customer: 'cus_1',
        id: 'cs_1',
        metadata: { kind: 'budget_topup', userId: 'user_1' },
        payment_intent: 'pi_1',
        payment_status: 'paid',
      },
    },
    id: 'evt_1',
    type: 'checkout.session.completed',
  } as unknown as Stripe.Event

  assert.deepEqual(await service.handle({ event, rawBody: '{"id":"evt_1"}' }), {
    duplicate: false,
    handled: true,
  })
  assert.equal(eventBus.events[0]?.topic, LIFECYCLE_EVENT_TOPIC)
  assert.deepEqual(
    (() => {
      const payload = eventBus.events[0]?.payload as {
        attributes: unknown
        idempotencyKey: string
        name: string
        resource: unknown
        userId: string
      }
      return {
        attributes: payload.attributes,
        idempotencyKey: payload.idempotencyKey,
        name: payload.name,
        resource: payload.resource,
        userId: payload.userId,
      }
    })(),
    {
      attributes: { provider: 'stripe', source: 'manual' },
      idempotencyKey: 'topup.succeeded:stripe:evt_1',
      name: 'topup.succeeded',
      resource: { id: 'cs_1', type: 'billing_topup' },
      userId: 'user_1',
    },
  )
})
