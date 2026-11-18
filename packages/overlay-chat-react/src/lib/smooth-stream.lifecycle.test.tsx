import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, type ReactElement } from 'react'
import { useSmoothStreamText } from './smooth-stream'

type TestNode = { props: Record<string, unknown>; children: Array<TestNode | string>; findByType(type: string): TestNode }
type TestRenderer = { root: TestNode; update(element: ReactElement): void; unmount(): void }
const { create } = createRequire(import.meta.url)('react-test-renderer') as { create(element: ReactElement): TestRenderer }

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })

test('settling a stream shows its full final text and cancels the pending reveal frame', async () => {
  const previousRequestFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
  const previousCancelFrame = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
  let nextFrame = 0
  const frames = new Map<number, FrameRequestCallback>()
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (callback: FrameRequestCallback) => {
      const id = nextFrame++
      frames.set(id, callback)
      return id
    },
    configurable: true,
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    value: (id: number) => { frames.delete(id) },
    configurable: true,
  })

  function Probe({ text, isStreaming }: { text: string; isStreaming: boolean }) {
    const latest = useSmoothStreamText(text, isStreaming)
    return React.createElement('span', { 'data-revealing': latest.revealing }, latest.text)
  }

  let renderer: TestRenderer | undefined
  const finalText = 'A complete final response whose last words are still buffered.'
  try {
    await act(async () => { renderer = create(React.createElement(Probe, { text: 'A complete', isStreaming: true })) })
    await act(async () => { renderer!.update(React.createElement(Probe, { text: finalText, isStreaming: true })) })
    assert.equal(renderer!.root.findByType('span').props['data-revealing'], true)
    assert.equal(renderer!.root.findByType('span').children.join(''), 'A complete')
    assert.equal(frames.size, 1)

    await act(async () => { renderer!.update(React.createElement(Probe, { text: finalText, isStreaming: false })) })
    assert.equal(renderer!.root.findByType('span').props['data-revealing'], false)
    assert.equal(renderer!.root.findByType('span').children.join(''), finalText)
    assert.equal(frames.size, 0)
  } finally {
    await act(async () => { renderer?.unmount() })
    if (previousRequestFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', previousRequestFrame)
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    if (previousCancelFrame) Object.defineProperty(globalThis, 'cancelAnimationFrame', previousCancelFrame)
    else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  }
})
