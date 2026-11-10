import assert from 'node:assert/strict'
import test from 'node:test'
import React, { type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { agentTurnSpacerHeight, useAgentTurnScroll } from './useAgentTurnScroll'
import type { RoomMessageRecord } from './room-message-view'

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })

test('new agent exchanges anchor at the top without discarding history or dragging the reader during streaming', async () => {
  const originals = Object.fromEntries(['document', 'getComputedStyle', 'ResizeObserver'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const spacer = { style: { height: '0px' }, get offsetHeight() { return Number.parseFloat(this.style.height) }, parentElement: {} }
  let contentHeight = 1200
  let targetTop = 1000
  const list = {
    scrollTop: 0,
    clientHeight: 600,
    get scrollHeight() { return contentHeight + spacer.offsetHeight },
    getBoundingClientRect: () => ({ top: 0 }),
  }
  const target = { getBoundingClientRect: () => ({ top: targetTop - list.scrollTop }) }
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: { getElementById: () => target } },
    getComputedStyle: { configurable: true, value: () => ({ paddingTop: '0' }) },
    ResizeObserver: { configurable: true, value: class { observe() {} disconnect() {} } },
  })
  let scroll!: ReturnType<typeof useAgentTurnScroll>
  function Harness({ messages, conversationId = 'room' }: { messages: RoomMessageRecord[]; conversationId?: string }) {
    scroll = useAgentTurnScroll({ enabled: true, conversationId, messages, listRef: { current: list } as unknown as RefObject<HTMLDivElement> })
    return <div ref={scroll.spacerRef} />
  }
  const history: RoomMessageRecord[] = [
    { id: 'old-user', turnId: 'old', authorKind: 'human', content: 'Previous question', createdAt: 1 },
    { id: 'old-agent', turnId: 'old-reply', authorKind: 'agent', content: 'Previous answer', createdAt: 2 },
  ]
  const pending: RoomMessageRecord = { id: 'optimistic_new', turnId: 'new', clientNonce: 'nonce', authorKind: 'human', content: 'Next question', delivery: 'sending', createdAt: 3 }
  let renderer!: ReactTestRenderer
  try {
    await act(async () => { renderer = create(<Harness messages={history} />, { createNodeMock: () => spacer }) })
    assert.equal(list.scrollTop, 0)
    const messages = [...history, pending]
    const snapshot = structuredClone(messages)
    await act(async () => { renderer.update(<Harness messages={messages} />) })
    assert.equal(list.scrollTop, 1000)
    assert.equal(spacer.style.height, '400px')
    assert.deepEqual(messages, snapshot)
    list.scrollTop = 400
    contentHeight = 1500
    await act(async () => { renderer.update(<Harness messages={[...history, { ...pending, id: 'saved', delivery: undefined }]} />) })
    assert.equal(list.scrollTop, 400, 'streaming must not pull the reader away from history')
    assert.equal(spacer.style.height, '100px')
    targetTop = 1600
    contentHeight = 1800
    await act(async () => { renderer.update(<Harness messages={[...messages, { ...pending, id: 'next', turnId: 'next', clientNonce: 'next-nonce' }]} />) })
    assert.equal(list.scrollTop, 1600)
    scroll.release()
    assert.equal(spacer.style.height, '0px')
    assert.equal(scroll.anchored.current, false)
    await act(async () => { renderer.update(<Harness conversationId="other-room" messages={history} />) })
    assert.equal(scroll.anchored.current, false)
  } finally {
    if (renderer) await act(async () => { renderer.unmount() })
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

test('turn space disappears once the response fills the viewport', () => {
  assert.equal(agentTurnSpacerHeight(600, 200), 400)
  assert.equal(agentTurnSpacerHeight(600, 900), 0)
})
