import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createRequire } from 'node:module'
import React, { act, type ReactElement, useEffect } from 'react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { publicTraceCacheKeyChanged, usePublicTrace } from './usePublicTrace'

type Props = Parameters<typeof usePublicTrace>[0]
type TraceResult = ReturnType<typeof usePublicTrace>
type Instance = { props: Record<string, unknown>; children: Array<Instance | string> }
type Renderer = {
  root: { findAllByType(type: string): Instance[] }
  update(element: ReactElement): void
  unmount(): void
}
const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: ReactElement): Renderer
}

function text(node: Instance | string): string {
  return typeof node === 'string' ? node : node.children.map(text).join('')
}

function response() {
  return new Response([
    JSON.stringify({ type: 'step', sequence: 0, persistence: { content: 'Complete answer.', parts: [{ type: 'text', text: 'Complete answer.' }] } }),
    JSON.stringify({ type: 'done', legacy: false, resultSummary: '' }),
    '',
  ].join('\n'), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
}

async function mount(t: TestContext, props: Props) {
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  let result!: TraceResult
  function Probe({ input }: { input: Props }) {
    const trace = usePublicTrace(input)
    useEffect(() => { result = trace }, [trace])
    return React.createElement('div', null, trace.workDetails)
  }
  let renderer!: Renderer
  await act(async () => { renderer = create(React.createElement(Probe, { input: props })) })
  t.after(async () => {
    await act(async () => renderer.unmount())
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  return {
    get result() { return result },
    renderer,
    async update(next: Props) {
      await act(async () => renderer.update(React.createElement(Probe, { input: next })))
    },
  }
}

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

test('public trace cache keys change with the message or enabled phase', () => {
  const key = { messageId: 'message-1', enabled: true }
  assert.equal(publicTraceCacheKeyChanged(key, key), false)
  assert.equal(publicTraceCacheKeyChanged(key, { ...key, enabled: false }), true)
  assert.equal(publicTraceCacheKeyChanged(key, { ...key, messageId: 'message-2' }), true)
})

test('completed traces stay cached across collapse and reopen', async t => {
  let requests = 0
  t.mock.method(overlayAppClient, 'request', async () => {
    requests++
    return response()
  })
  const mounted = await mount(t, { messageId: 'message-1', enabled: true, blocks: [] })

  await act(async () => mounted.result.onWorkExpandedChange(true))
  await settle()
  assert.equal(requests, 1)
  assert.equal(mounted.renderer.root.findAllByType('p').length, 0)

  await act(async () => mounted.result.onWorkExpandedChange(false))
  await act(async () => mounted.result.onWorkExpandedChange(true))
  await settle()
  assert.equal(requests, 1)
})

test('same-message traces refetch after the enabled phase changes', async t => {
  let requests = 0
  t.mock.method(overlayAppClient, 'request', async () => {
    requests++
    return response()
  })
  const props = { messageId: 'message-1', enabled: true, blocks: [] }
  const mounted = await mount(t, props)

  await act(async () => mounted.result.onWorkExpandedChange(true))
  await settle()
  assert.equal(requests, 1)

  await mounted.update({ ...props, enabled: false })
  await mounted.update(props)
  await settle()
  assert.equal(requests, 2)
})

test('retry clears the error and shows loading until the new trace arrives', async t => {
  let requests = 0
  let resolveRetry!: (value: Response) => void
  t.mock.method(overlayAppClient, 'request', async () => {
    requests++
    if (requests === 1) throw new Error('Network unavailable.')
    return new Promise<Response>(resolve => { resolveRetry = resolve })
  })
  const mounted = await mount(t, { messageId: 'message-1', enabled: true, blocks: [] })
  await act(async () => mounted.result.onWorkExpandedChange(true))
  await settle()
  assert.match(mounted.renderer.root.findAllByType('p').map(text).join(' '), /Could not load the full trace/)

  const retry = mounted.renderer.root.findAllByType('button').find(button => text(button) === 'Retry')
  assert.ok(retry)
  await act(async () => { (retry.props.onClick as () => void)() })
  assert.equal(requests, 2)
  assert.match(mounted.renderer.root.findAllByType('p').map(text).join(' '), /Loading full trace/)
  assert.doesNotMatch(mounted.renderer.root.findAllByType('p').map(text).join(' '), /Could not load the full trace/)

  await act(async () => { resolveRetry(response()) })
  await settle()
  assert.equal(mounted.renderer.root.findAllByType('p').length, 0)
})
