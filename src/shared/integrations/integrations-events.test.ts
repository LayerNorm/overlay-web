import assert from 'node:assert/strict'
import test from 'node:test'
import {
  INTEGRATIONS_BC_CHANNEL,
  INTEGRATIONS_FAILED_STORAGE_KEY,
  subscribeIntegrationsFailed,
} from './integrations-events'

type StorageListener = (event: StorageEvent) => void

const storageListeners = new Set<StorageListener>()
const channels = new Set<MockBroadcastChannel>()

class MockBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(readonly name: string) {
    channels.add(this)
  }

  postMessage(data: unknown) {
    for (const channel of channels) {
      if (channel !== this && channel.name === this.name) channel.onmessage?.({ data } as MessageEvent)
    }
  }

  close() {
    channels.delete(this)
  }
}

function withBrowserMocks(run: () => void, broadcastChannelAvailable = true) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousBroadcastChannel = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel')
  const mockWindow = {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'storage') storageListeners.add(listener as StorageListener)
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'storage') storageListeners.delete(listener as StorageListener)
    },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow })
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    value: broadcastChannelAvailable ? MockBroadcastChannel : undefined,
  })
  try {
    run()
  } finally {
    storageListeners.clear()
    channels.clear()
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousBroadcastChannel) Object.defineProperty(globalThis, 'BroadcastChannel', previousBroadcastChannel)
    else Reflect.deleteProperty(globalThis, 'BroadcastChannel')
  }
}

function dispatchFailureStorage(attemptId: string) {
  const event = {
    key: INTEGRATIONS_FAILED_STORAGE_KEY,
    newValue: JSON.stringify({ attemptId }),
  } as StorageEvent
  for (const listener of storageListeners) listener(event)
}

test('ignores older attempt failures and notifies the matching attempt once', () => {
  withBrowserMocks(() => {
    let notifications = 0
    const unsubscribe = subscribeIntegrationsFailed('current-attempt', () => { notifications += 1 })
    const sender = new MockBroadcastChannel(INTEGRATIONS_BC_CHANNEL)

    sender.postMessage({ type: 'failed', attemptId: 'older-attempt' })
    dispatchFailureStorage('older-attempt')
    assert.equal(notifications, 0)

    sender.postMessage({ type: 'failed', attemptId: 'current-attempt' })
    assert.equal(notifications, 1)
    dispatchFailureStorage('current-attempt')
    assert.equal(notifications, 1)

    unsubscribe()
    sender.close()
  })
})

test('isolates simultaneous pending attempts', () => {
  withBrowserMocks(() => {
    let notificationsA = 0
    let notificationsB = 0
    const unsubscribeA = subscribeIntegrationsFailed('attempt-a', () => { notificationsA += 1 })
    const unsubscribeB = subscribeIntegrationsFailed('attempt-b', () => { notificationsB += 1 })
    const sender = new MockBroadcastChannel(INTEGRATIONS_BC_CHANNEL)

    sender.postMessage({ type: 'failed', attemptId: 'attempt-a' })
    assert.equal(notificationsA, 1)
    assert.equal(notificationsB, 0)
    sender.postMessage({ type: 'failed', attemptId: 'attempt-b' })
    assert.equal(notificationsA, 1)
    assert.equal(notificationsB, 1)

    unsubscribeA()
    unsubscribeB()
    sender.close()
  })
})

test('matches the storage fallback when BroadcastChannel is unavailable', () => {
  withBrowserMocks(() => {
    let notifications = 0
    const unsubscribe = subscribeIntegrationsFailed('current-attempt', () => { notifications += 1 })

    dispatchFailureStorage('other-attempt')
    assert.equal(notifications, 0)
    dispatchFailureStorage('current-attempt')
    assert.equal(notifications, 1)

    unsubscribe()
  }, false)
})
