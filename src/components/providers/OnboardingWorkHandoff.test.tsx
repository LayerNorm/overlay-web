import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, useState } from 'react'
import { AppScreenShell } from '@overlay/modules-react/shell'
import { OnboardingWorkHandoff, useOnboardingWorkReady } from './OnboardingWorkHandoff'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement, options?: { createNodeMock(element: { props: Record<string, unknown> }): unknown }): {
    update(element: React.ReactElement): void
    unmount(): void
    toJSON(): unknown
    root: { findByProps(props: Record<string, unknown>): { props: Record<string, unknown> } }
  }
}

function Work({ taskId, ready }: { taskId: string | null; ready: boolean }) {
  useOnboardingWorkReady(taskId, !taskId)
  return <AppScreenShell rightPanel={taskId ? <Task taskId={taskId} ready={ready} /> : null} rightPanelOpen={Boolean(taskId)}>
    <span>Work list loaded</span>
  </AppScreenShell>
}

function Task({ taskId, ready }: { taskId: string; ready: boolean }) {
  const content = useOnboardingWorkReady(taskId, ready)
  return <div ref={content} data-testid="work-peek">{ready ? 'Work rendered' : 'Work loading'}</div>
}

function Harness({ route, taskId, ready, onTaskMissing = () => {} }: { route: 'work' | 'chats'; taskId: string | null; ready: boolean; onTaskMissing?(): void }) {
  const [pending, setPending] = useState(true)
  return <>
    {pending ? <span>Onboarding composer</span> : null}
    <OnboardingWorkHandoff pending={pending ? { taskId: 'first-task', onReady: () => setPending(false), onTaskMissing } : null}>
      {route === 'work' ? <Work taskId={taskId} ready={ready} /> : <span>Chats rendered</span>}
    </OnboardingWorkHandoff>
  </>
}

test('onboarding remains visible through route loading and never returns after Work is ready', async (t) => {
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  let opacity = '0.5'
  let width = 520
  const globals = {
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame },
    cancelAnimationFrame: (id: number) => { frames.delete(id) },
    getComputedStyle: () => ({ opacity }),
  }
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
  let renderer!: ReturnType<typeof create>
  let recoveries = 0
  const panel = {
    getAttribute: (name: string) => String(renderer.root.findByProps({ 'data-slot': 'app-screen-right-panel' }).props[name]),
    getBoundingClientRect: () => ({ width }),
  }
  await act(async () => {
    renderer = create(<Harness route="chats" taskId={null} ready={false} />, {
      createNodeMock: (element) => element.props['data-testid'] === 'work-peek' ? { closest: () => panel } : null,
    })
  })
  const output = () => JSON.stringify(renderer.toJSON())
  const paint = async () => {
    const callbacks = [...frames.values()]
    frames.clear()
    await act(async () => { callbacks.forEach((callback) => callback(nextFrame)) })
  }
  try {
    assert.match(output(), /Onboarding composer/)
    for (const [taskId, ready] of [[null, true], ['other-task', true], ['first-task', false]] as const) {
      await act(async () => renderer.update(<Harness route="work" taskId={taskId} ready={ready} onTaskMissing={() => { recoveries++ }} />))
      await paint()
      assert.match(output(), /Onboarding composer/)
      assert.match(output(), /absolute inset-0 z-0/)
    }
    assert.equal(recoveries, 2, 'missing or wrong task queries restore the intended task before reveal')
    for (let frame = 0; frame < 4; frame++) await paint()
    assert.match(output(), /Onboarding composer/, 'a loaded Work list cannot reveal a loading peek')
    await act(async () => renderer.update(<Harness route="work" taskId="first-task" ready />))
    await paint()
    assert.match(output(), /Onboarding composer/, 'the panel entrance is still transparent')
    opacity = '1'
    width = 0
    await paint()
    assert.match(output(), /Onboarding composer/, 'a panel without layout cannot be painted')
    width = 520
    await paint()
    assert.match(output(), /Onboarding composer/, 'retain the composer through the first visible panel paint')
    await act(async () => renderer.update(<Harness route="work" taskId="first-task" ready={false} />))
    await paint()
    assert.match(output(), /Onboarding composer/, 'loading again cancels the pending reveal')
    await act(async () => renderer.update(<Harness route="work" taskId="first-task" ready />))
    await paint()
    assert.match(output(), /Onboarding composer/)
    await paint()
    assert.doesNotMatch(output(), /Onboarding composer/)
    assert.match(output(), /Work rendered/)
    assert.match(output(), /"aria-hidden":false/)
    await act(async () => renderer.update(<Harness route="chats" taskId={null} ready={false} />))
    assert.doesNotMatch(output(), /Onboarding composer/)
    assert.match(output(), /Chats rendered/)
  } finally {
    await act(async () => renderer.unmount())
    assert.equal(frames.size, 0, 'unmount cancels outstanding animation frames')
  }
})
