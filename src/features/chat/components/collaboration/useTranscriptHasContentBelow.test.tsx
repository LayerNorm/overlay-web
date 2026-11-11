import assert from 'node:assert/strict'
import test from 'node:test'
import React, { useRef, type RefObject } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { useTranscriptHasContentBelow } from './useTranscriptHasContentBelow'

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })

test('jump visibility follows content below on scroll and streaming resize, not unread count or turn spacer', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
  const observers = new Set<() => void>()
  const listeners = new Set<() => void>()
  const spacer = { offsetHeight: 0 }
  const list = {
    scrollHeight: 600, scrollTop: 0, clientHeight: 600, firstElementChild: {},
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      constructor(private callback: () => void) { observers.add(callback) }
      observe() {}
      disconnect() { observers.delete(this.callback) }
    },
  })
  function Harness() {
    const listRef = useRef<HTMLDivElement>(null)
    const hasContentBelow = useTranscriptHasContentBelow(listRef, { current: spacer } as RefObject<HTMLDivElement>)
    return <div ref={listRef} data-content-below={hasContentBelow} />
  }
  let renderer!: ReactTestRenderer
  const visible = () => renderer.root.findByType('div').props['data-content-below']
  const resize = () => act(async () => { for (const callback of [...observers]) callback() })
  const scroll = () => act(async () => { for (const callback of [...listeners]) callback() })
  try {
    await act(async () => { renderer = create(<Harness />, { createNodeMock: () => list }) })
    await resize()
    assert.equal(visible(), false, 'empty transcript has nothing below')
    list.scrollHeight = 1200
    await resize()
    assert.equal(visible(), true, 'content growth shows the control without a new message count')
    list.scrollTop = 600
    await scroll()
    assert.equal(visible(), false, 'bottom hides the control')
    list.scrollTop = 590
    await scroll()
    assert.equal(visible(), true, 'even within the auto-follow threshold there is content below')
    spacer.offsetHeight = 400
    list.scrollHeight = 1600
    list.scrollTop = 600
    await resize()
    assert.equal(visible(), false, 'anchor spacer alone is not unread content below')
    list.scrollTop = 200
    await scroll()
    assert.equal(visible(), true, 'scrolling into history while anchored shows the control')
    spacer.offsetHeight = 0
    list.scrollTop = 1000
    await scroll()
    assert.equal(visible(), false)
    list.scrollHeight = 2000
    await resize()
    assert.equal(visible(), true, 'streaming content below the viewport shows the control')
  } finally {
    if (renderer) await act(async () => { renderer.unmount() })
    if (original) Object.defineProperty(globalThis, 'ResizeObserver', original)
    else Reflect.deleteProperty(globalThis, 'ResizeObserver')
  }
  assert.equal(listeners.size, 0)
  assert.equal(observers.size, 0)
})
