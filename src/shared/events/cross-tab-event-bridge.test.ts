import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCrossTabEventBridge,
  type CrossTabEventEnvelope,
  type CrossTabEventTransport,
} from './cross-tab-event-bridge'

function createBus() {
  const listeners = new Set<(message: unknown) => void>()
  const messages: CrossTabEventEnvelope[] = []
  const transport: CrossTabEventTransport = {
    publish(message) {
      messages.push(message)
      for (const listener of listeners) listener(message)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return { messages, transport }
}

test('cross-tab bridge forwards supported events once without echoing', () => {
  const bus = createBus()
  const firstTab = new EventTarget()
  const secondTab = new EventTarget()
  let nextId = 0
  const first = createCrossTabEventBridge({
    createId: () => `message-${++nextId}`,
    eventTarget: firstTab,
    eventTypes: ['overlay:knowledge-entity-mutation'],
    sourceId: 'tab-a',
    transport: bus.transport,
  })
  const second = createCrossTabEventBridge({
    createId: () => `message-${++nextId}`,
    eventTarget: secondTab,
    eventTypes: ['overlay:knowledge-entity-mutation'],
    sourceId: 'tab-b',
    transport: bus.transport,
  })
  const received: unknown[] = []
  secondTab.addEventListener('overlay:knowledge-entity-mutation', (event) => {
    received.push((event as CustomEvent<unknown>).detail)
  })

  firstTab.dispatchEvent(new CustomEvent('overlay:knowledge-entity-mutation', {
    detail: { id: 'file-1', operation: 'updated' },
  }))

  assert.deepEqual(received, [{ id: 'file-1', operation: 'updated' }])
  assert.equal(bus.messages.length, 1)
  first.dispose()
  second.dispose()
})

test('cross-tab bridge rejects duplicate and unsupported messages', () => {
  const bus = createBus()
  const target = new EventTarget()
  let received = 0
  const bridge = createCrossTabEventBridge({
    eventTarget: target,
    eventTypes: ['overlay:projects-changed'],
    sourceId: 'tab-b',
    transport: bus.transport,
  })
  target.addEventListener('overlay:projects-changed', () => { received += 1 })
  const duplicate = {
    eventType: 'overlay:projects-changed',
    messageId: 'same-message',
    sourceId: 'tab-a',
  }

  bus.transport.publish(duplicate)
  bus.transport.publish(duplicate)
  bus.transport.publish({ ...duplicate, eventType: 'overlay:unsupported', messageId: 'other-message' })

  assert.equal(received, 1)
  bridge.dispose()
})
