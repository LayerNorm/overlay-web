import assert from 'node:assert/strict'
import test from 'node:test'
import type { LifecycleEvent } from '@/server/lifecycle-events'
import { productEventForLifecycle } from './posthog-server'

const base = {
  classification: 'operational',
  destinations: ['analytics', 'audit', 'email', 'metrics', 'notification'],
  occurredAt: 1,
  schemaVersion: 1,
  userId: 'user_1',
} as const

test('a new user becomes the signup event, with only the auth provider', () => {
  const event = {
    ...base,
    attributes: { authProvider: 'workos' },
    eventId: 'lifecycle_1',
    idempotencyKey: 'user.created:user_1',
    name: 'user.created',
    resource: { id: 'user_1', type: 'user' },
  } as LifecycleEvent

  assert.deepEqual(productEventForLifecycle(event), {
    name: 'user.signed_up',
    properties: { authProvider: 'workos' },
    userId: 'user_1',
  })
})

test('billing and automation lifecycle events are no longer sent to analytics', () => {
  const subscription = {
    ...base,
    attributes: { changeSource: 'provider_webhook', planKind: 'paid', provider: 'stripe', status: 'active' },
    eventId: 'lifecycle_2',
    idempotencyKey: 'subscription.changed:stripe:evt_1',
    name: 'subscription.changed',
    resource: { id: 'sub_1', type: 'subscription' },
  } as LifecycleEvent
  const automation = {
    ...base,
    attributes: { execution: 'scheduled', failureClass: 'provider' },
    eventId: 'lifecycle_3',
    idempotencyKey: 'automation.failed:run_1',
    name: 'automation.failed',
    resource: { automationId: 'automation_1', id: 'run_1', type: 'automation_run' },
  } as LifecycleEvent

  assert.equal(productEventForLifecycle(subscription), null)
  assert.equal(productEventForLifecycle(automation), null)
})
