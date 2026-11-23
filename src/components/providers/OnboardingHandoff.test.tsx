import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, useState } from 'react'
import { OnboardingHandoff, useOnboardingHandoffReady } from './OnboardingHandoff'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void; toJSON(): unknown }
}

function AgentChat({ conversationId, ready }: { conversationId: string | null; ready: boolean }) {
  useOnboardingHandoffReady(conversationId, ready)
  return <span>{ready ? 'Chat rendered' : 'Chat loading'}</span>
}

function Harness({ route, conversationId, ready, onConversationMissing = () => {} }: { route: 'agents' | 'work'; conversationId: string | null; ready: boolean; onConversationMissing?(): void }) {
  const [pending, setPending] = useState(true)
  return <>
    {pending ? <span>Onboarding composer</span> : null}
    <OnboardingHandoff pending={pending ? { conversationId: 'onboarding-chat', onReady: () => setPending(false), onConversationMissing } : null}>
      {route === 'agents' ? <AgentChat conversationId={conversationId} ready={ready} /> : <span>Work rendered</span>}
    </OnboardingHandoff>
  </>
}

test('onboarding stays over the Agents page until its conversation has painted', async (t) => {
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  const globals = {
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame },
    cancelAnimationFrame: (id: number) => { frames.delete(id) },
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
  await act(async () => { renderer = create(<Harness route="work" conversationId={null} ready={false} />) })
  const output = () => JSON.stringify(renderer.toJSON())
  const paint = async () => {
    const callbacks = [...frames.values()]
    frames.clear()
    await act(async () => { callbacks.forEach((callback) => callback(nextFrame)) })
  }
  try {
    assert.match(output(), /Onboarding composer/)
    for (const [conversationId, ready] of [['other-chat', true], ['onboarding-chat', false]] as const) {
      await act(async () => renderer.update(<Harness route="agents" conversationId={conversationId} ready={ready} onConversationMissing={() => { recoveries++ }} />))
      await paint()
      assert.match(output(), /Onboarding composer/)
      assert.match(output(), /absolute inset-0 z-0/)
    }
    assert.equal(recoveries, 1, 'a different conversation reopens the onboarding thread before reveal')
    await act(async () => renderer.update(<Harness route="agents" conversationId="onboarding-chat" ready />))
    await paint()
    assert.match(output(), /Onboarding composer/, 'retain the composer through the first paint')
    await paint()
    assert.doesNotMatch(output(), /Onboarding composer/)
    assert.match(output(), /Chat rendered/)
    assert.match(output(), /"aria-hidden":false/)
  } finally {
    await act(async () => renderer.unmount())
    assert.equal(frames.size, 0, 'unmount cancels outstanding animation frames')
  }
})
