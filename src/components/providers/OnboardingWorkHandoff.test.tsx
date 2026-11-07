import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, useState } from 'react'
import { OnboardingWorkHandoff, useOnboardingWorkReady } from './OnboardingWorkHandoff'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): {
    update(element: React.ReactElement): void
    unmount(): void
    toJSON(): unknown
  }
}

function Work({ taskId, ready }: { taskId: string | null; ready: boolean }) {
  useOnboardingWorkReady(taskId, ready)
  return <span>{ready ? 'Work rendered' : 'Work loading'}</span>
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
  const original = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', original)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  let renderer!: ReturnType<typeof create>
  let recoveries = 0
  await act(() => { renderer = create(<Harness route="chats" taskId={null} ready={false} />) })
  const output = () => JSON.stringify(renderer.toJSON())
  try {
    assert.match(output(), /Onboarding composer/)
    for (const [taskId, ready] of [[null, true], ['other-task', true], ['first-task', false]] as const) {
      await act(() => renderer.update(<Harness route="work" taskId={taskId} ready={ready} onTaskMissing={() => { recoveries++ }} />))
      assert.match(output(), /Onboarding composer/)
      assert.match(output(), /"hidden":true/)
    }
    assert.equal(recoveries, 2, 'missing or wrong task queries restore the intended task before reveal')
    await act(() => renderer.update(<Harness route="work" taskId="first-task" ready />))
    assert.doesNotMatch(output(), /Onboarding composer/)
    assert.match(output(), /Work rendered/)
    assert.match(output(), /"hidden":false/)
    await act(() => renderer.update(<Harness route="chats" taskId={null} ready={false} />))
    assert.doesNotMatch(output(), /Onboarding composer/)
    assert.match(output(), /Chats rendered/)
  } finally {
    await act(() => renderer.unmount())
  }
})
