import assert from 'node:assert/strict'
import test from 'node:test'
import type { EventBus } from '@overlay/app-core'
import {
  LIFECYCLE_EVENT_TOPIC,
  LifecycleEventPublisher,
  destinationsForLifecycleEvent,
  type LifecycleEvent,
} from '.'

class CapturingEventBus implements EventBus {
  readonly events: Array<{ payload: unknown; topic: string }> = []

  async publish(topic: string, payload: unknown): Promise<void> {
    this.events.push({ topic, payload })
  }

  subscribe(): () => void {
    return () => {}
  }
}

test('LifecycleEventPublisher emits a metadata-only, versioned lifecycle event to its declared sinks', async () => {
  const eventBus = new CapturingEventBus()
  const auditEvents: LifecycleEvent[] = []
  const publisher = new LifecycleEventPublisher({
    clock: { now: () => 1_700_000_000_000 },
    eventBus,
    sinks: [{
      destination: 'audit',
      async deliver(event) {
        auditEvents.push(event)
      },
    }],
  })

  const event = await publisher.publish({
    attributes: { authProvider: 'oidc' },
    idempotencyKey: 'user.created:oidc:user_1',
    name: 'user.created',
    resource: { id: 'user_1', type: 'user' },
    userId: 'user_1',
  })

  assert.ok(event)
  assert.equal(eventBus.events[0]?.topic, LIFECYCLE_EVENT_TOPIC)
  assert.equal(event?.schemaVersion, 1)
  assert.equal(event?.occurredAt, 1_700_000_000_000)
  assert.deepEqual(event?.destinations, ['analytics', 'audit', 'email', 'notification'])
  assert.equal(auditEvents[0]?.eventId, event?.eventId)
  assert.deepEqual(Object.keys(event ?? {}).sort(), [
    'attributes',
    'classification',
    'destinations',
    'eventId',
    'idempotencyKey',
    'name',
    'occurredAt',
    'resource',
    'schemaVersion',
    'userId',
  ])
  assert.equal('email' in (event?.attributes ?? {}), false)
  assert.equal('prompt' in (event?.attributes ?? {}), false)
  assert.equal('document' in (event?.attributes ?? {}), false)
  assert.equal('token' in (event?.attributes ?? {}), false)
})

test('LifecycleEventPublisher is inert when lifecycle events are disabled', async () => {
  const eventBus = new CapturingEventBus()
  const publisher = new LifecycleEventPublisher({
    enabled: () => false,
    eventBus,
  })

  const event = await publisher.publish({
    attributes: { provider: 'stripe', source: 'manual' },
    idempotencyKey: 'topup.succeeded:checkout:cs_1',
    name: 'topup.succeeded',
    resource: { id: 'cs_1', type: 'billing_topup' },
    userId: 'user_1',
  })

  assert.equal(event, null)
  assert.equal(eventBus.events.length, 0)
})

test('LifecycleEventPublisher rejects identifier fields that could carry contact or free-form data', async () => {
  const eventBus = new CapturingEventBus()
  const publisher = new LifecycleEventPublisher({ eventBus })

  const event = await publisher.publish({
    attributes: { authProvider: 'oidc' },
    idempotencyKey: 'user.created:oidc:person@example.com',
    name: 'user.created',
    resource: { id: 'person@example.com', type: 'user' },
    userId: 'person@example.com',
  })

  assert.equal(event, null)
  assert.equal(eventBus.events.length, 0)
})

test('LifecycleEventPublisher isolates delivery failures from the source workflow', async () => {
  const failures: Array<{ destination: string; eventName: string }> = []
  const publisher = new LifecycleEventPublisher({
    eventBus: {
      async publish() {
        throw new Error('event bus unavailable')
      },
      subscribe() {
        return () => {}
      },
    },
    onDeliveryFailure: (failure) => failures.push(failure),
    sinks: [{
      destination: 'audit',
      async deliver() {
        throw new Error('audit unavailable')
      },
    }],
  })

  const event = await publisher.publish({
    attributes: { provider: 'stripe', source: 'manual' },
    idempotencyKey: 'topup.succeeded:checkout:cs_1',
    name: 'topup.succeeded',
    resource: { id: 'cs_1', type: 'billing_topup' },
    userId: 'user_1',
  })

  assert.equal(event?.name, 'topup.succeeded')
  assert.deepEqual(failures, [
    { destination: 'event_bus', eventName: 'topup.succeeded' },
    { destination: 'audit', eventName: 'topup.succeeded' },
  ])
})

test('lifecycle catalog declares destinations without creating external delivery paths', () => {
  assert.deepEqual(destinationsForLifecycleEvent('automation.failed'), [
    'analytics',
    'audit',
    'email',
    'notification',
  ])
  assert.deepEqual(destinationsForLifecycleEvent('automation.succeeded'), [
    'analytics',
    'audit',
    'notification',
  ])
})
