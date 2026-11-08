import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act } from 'react'
import { LandingHeadline } from './LandingHeadline'

type TestNode = { props: Record<string, unknown>; findAllByType(type: string): TestNode[] }
const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement, options: { createNodeMock(): unknown }): {
    root: { findByType(type: string): TestNode; findAllByProps(props: Record<string, unknown>): TestNode[] }
    unmount(): void
  }
}

test('headlines alternate every five seconds, preserve links, and pause for focus or hidden tabs', async (t) => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  const documentMock = Object.assign(new EventTarget(), { hidden: false, activeElement: null })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.mock.timers.enable({ apis: ['setInterval'] })
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  let focused = false
  let renderer!: ReturnType<typeof create>
  await act(() => { renderer = create(<LandingHeadline />, { createNodeMock: () => ({ contains: () => focused }) }) })
  const faces = () => renderer.root.findAllByProps({ className: 'headline-face' })
  const visible = () => faces().findIndex(face => face.props['aria-hidden'] === false)
  try {
    assert.equal(visible(), 0)
    assert.equal(renderer.root.findByType('h1').props['data-animated'], undefined)
    assert.equal(faces()[1].props.inert, true)
    await act(() => t.mock.timers.tick(4999))
    assert.equal(visible(), 0)
    await act(() => t.mock.timers.tick(1))
    assert.equal(visible(), 1)
    assert.equal(faces()[0].props.inert, true)
    assert.deepEqual(faces()[1].findAllByType('a').map(link => [link.props.href, link.props.style]), [
      ['#ai-employees', { '--k': '#ea580c' }], ['#control-plane', { '--k': '#7c3aed' }],
    ])
    await act(() => t.mock.timers.tick(5000))
    assert.equal(visible(), 0)
    focused = true
    await act(() => t.mock.timers.tick(5000))
    assert.equal(visible(), 0)
    focused = false
    documentMock.hidden = true
    documentMock.dispatchEvent(new Event('visibilitychange'))
    await act(() => t.mock.timers.tick(20000))
    assert.equal(visible(), 0)
    documentMock.hidden = false
    documentMock.dispatchEvent(new Event('visibilitychange'))
    await act(() => t.mock.timers.tick(5000))
    assert.equal(visible(), 1)
  } finally {
    await act(() => renderer.unmount())
  }
  assert.equal(documentMock.dispatchEvent(new Event('visibilitychange')), true)
  await act(() => t.mock.timers.tick(5000))
})
