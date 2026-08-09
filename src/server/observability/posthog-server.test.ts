import assert from 'node:assert/strict'
import test from 'node:test'
import type { LifecycleEvent } from '@/server/lifecycle-events'
import { productEventForLifecycle } from './posthog-server'

test('lifecycle events map to the minimum product event catalog without PII properties', () => {
  const subscriptionEvent: LifecycleEvent = {
    attributes: {
      changeSource: 'provider_webhook',
      planKind: 'paid',
      provider: 'stripe',
      status: 'active',
    },
    classification: 'operational',
    destinations: ['analytics', 'audit', 'email', 'metrics', 'notification'],
    eventId: 'lifecycle_1',
    idempotencyKey: 'subscription.changed:stripe:evt_1',
    name: 'subscription.changed',
    occurredAt: 1,
    resource: { id: 'sub_1', type: 'subscription' },
    schemaVersion: 1,
    userId: 'user_1',
  }

  assert.deepEqual(productEventForLifecycle(subscriptionEvent), {
    name: 'billing.subscription.changed',
    properties: subscriptionEvent.attributes,
    userId: 'user_1',
  })
})

test('automation failure metrics retain classification but never the raw error', () => {
  const automationEvent: LifecycleEvent = {
    attributes: { execution: 'scheduled', failureClass: 'provider' },
    classification: 'operational',
    destinations: ['analytics', 'audit', 'email', 'metrics', 'notification'],
    eventId: 'lifecycle_2',
    idempotencyKey: 'automation.failed:run_1',
    name: 'automation.failed',
    occurredAt: 1,
    resource: { automationId: 'automation_1', id: 'run_1', type: 'automation_run' },
    schemaVersion: 1,
    userId: 'user_1',
  }

  assert.deepEqual(productEventForLifecycle(automationEvent), {
    name: 'automation.run.failed',
    properties: { execution: 'scheduled', failureClass: 'provider' },
    userId: 'user_1',
  })
})
