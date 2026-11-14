import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createRequire } from 'node:module'
import React, { act, useEffect, type ReactElement } from 'react'
import type { QueuedMessage } from '@/shared/chat/conversation-queue'
import { queueStorageKey } from '@/shared/chat/conversation-queue'
import { useComposerQueue, type ComposerQueue } from './useComposerQueue'

type Renderer = { update(element: ReactElement): void; unmount(): void }
const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: ReactElement): Renderer
}

const cleanups = new WeakMap<TestContext, Array<() => void>>()

function browser(t: TestContext) {
  const callbacks: Array<() => void> = []
  cleanups.set(t, callbacks)
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  const values = new Map<string, string>()
  const timers = new Map<number, () => void>()
  let timerId = 0
  const window = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    },
    setTimeout: (callback: () => void) => {
      const id = ++timerId
      timers.set(id, callback)
      return id
    },
    clearTimeout: (id: number) => { timers.delete(id) },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(() => {
    for (const callback of callbacks.reverse()) callback()
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  return { values }
}

type Props = { conversationId: string | null; running: boolean }

async function mountQueue(t: TestContext, initial: Props, accept: (message: QueuedMessage) => boolean = () => true) {
  const sent: string[] = []
  let stops = 0
  let queue!: ComposerQueue
  function Probe({ conversationId, running }: Props) {
    const current = useComposerQueue({
      scope: conversationId ? { workspaceId: 'w1', conversationId } : null,
      running,
      send: async (message) => {
        sent.push(message.text)
        return accept(message)
      },
      stop: () => { stops += 1 },
    })
    useEffect(() => { queue = current })
    return null
  }
  let renderer!: Renderer
  await act(async () => { renderer = create(<Probe {...initial} />) })
  cleanups.get(t)?.push(() => act(() => renderer.unmount()))
  return {
    sent,
    get stops() { return stops },
    get queue() { return queue },
    async render(props: Props) {
      await act(async () => { renderer.update(<Probe {...props} />) })
    },
    async run(action: (queue: ComposerQueue) => void) {
      await act(async () => { action(queue) })
    },
  }
}

test('queued messages wait for the response and then send one per response, in order', async (t) => {
  browser(t)
  const view = await mountQueue(t, { conversationId: 'c1', running: true })
  await view.run(queue => {
    queue.enqueue('first', [])
    queue.enqueue('second', [])
  })
  assert.deepEqual(view.sent, [])
  assert.deepEqual(view.queue.items.map(item => item.text), ['first', 'second'])

  await view.render({ conversationId: 'c1', running: false })
  assert.deepEqual(view.sent, ['first'])
  await view.render({ conversationId: 'c1', running: true })
  assert.deepEqual(view.sent, ['first'])
  await view.render({ conversationId: 'c1', running: false })
  assert.deepEqual(view.sent, ['first', 'second'])
  assert.equal(view.queue.items.length, 0)
})

test('steering stops the running response and sends ahead of queued messages', async (t) => {
  browser(t)
  const view = await mountQueue(t, { conversationId: 'c1', running: true })
  await view.run(queue => queue.enqueue('later', []))
  await view.run(queue => queue.steer('change course', []))
  assert.equal(view.stops, 1)
  assert.deepEqual(view.queue.items.map(item => item.text), ['change course', 'later'])

  await view.render({ conversationId: 'c1', running: false })
  assert.deepEqual(view.sent, ['change course'])
})

test('steering a queued message moves it to the front and stops the response', async (t) => {
  browser(t)
  const view = await mountQueue(t, { conversationId: 'c1', running: true })
  await view.run(queue => {
    queue.enqueue('a', [])
    queue.enqueue('b', [])
  })
  const b = view.queue.items[1]!.id
  await view.run(queue => queue.steerItem(b))
  assert.equal(view.stops, 1)
  assert.deepEqual(view.queue.items.map(item => item.text), ['b', 'a'])
})

test('a manual stop pauses the queue until the person sends another message', async (t) => {
  browser(t)
  const view = await mountQueue(t, { conversationId: 'c1', running: true })
  await view.run(queue => queue.enqueue('held', []))
  await view.run(queue => queue.pause())
  await view.render({ conversationId: 'c1', running: false })
  assert.deepEqual(view.sent, [])
  assert.equal(view.queue.paused, true)

  await view.render({ conversationId: 'c1', running: true })
  await view.render({ conversationId: 'c1', running: false })
  assert.deepEqual(view.sent, ['held'])
})

test('a message that is not accepted returns to the front and pauses the queue', async (t) => {
  browser(t)
  const view = await mountQueue(t, { conversationId: 'c1', running: true }, () => false)
  await view.run(queue => {
    queue.enqueue('blocked', [])
    queue.enqueue('next', [])
  })
  await view.render({ conversationId: 'c1', running: false })
  assert.deepEqual(view.sent, ['blocked'])
  assert.equal(view.queue.paused, true)
  assert.deepEqual(view.queue.items.map(item => item.text), ['blocked', 'next'])
})

test('editing takes a message out of the queue', async (t) => {
  browser(t)
  const view = await mountQueue(t, { conversationId: 'c1', running: true })
  await view.run(queue => queue.enqueue('typo', []))
  let taken: QueuedMessage | null = null
  await view.run(queue => { taken = queue.take(queue.items[0]!.id) })
  assert.equal((taken as QueuedMessage | null)?.text, 'typo')
  assert.equal(view.queue.items.length, 0)
})

test('the queue persists per conversation and follows a new chat to its id', async (t) => {
  const { values } = browser(t)
  const view = await mountQueue(t, { conversationId: null, running: true })
  await view.run(queue => queue.enqueue('from the first turn', []))
  await view.render({ conversationId: 'c-new', running: true })
  assert.deepEqual(view.queue.items.map(item => item.text), ['from the first turn'])
  const stored = JSON.parse(values.get(queueStorageKey({ workspaceId: 'w1', conversationId: 'c-new' })) ?? '[]') as QueuedMessage[]
  assert.deepEqual(stored.map(item => item.text), ['from the first turn'])

  await view.render({ conversationId: 'c-other', running: false })
  assert.equal(view.queue.items.length, 0)
  await view.render({ conversationId: 'c-new', running: true })
  assert.deepEqual(view.queue.items.map(item => item.text), ['from the first turn'])
})
