import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, useEffect } from 'react'
import { useAgentExpansion } from './useAgentExpansion'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): {
    update(element: React.ReactElement): void
    unmount(): void
  }
}

test('selected agent can collapse until navigation selects it again', async (t) => {
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(() => {
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })

  let state!: ReturnType<typeof useAgentExpansion>
  function Probe({ active }: { active: string | null }) {
    const expansion = useAgentExpansion(active)
    useEffect(() => { state = expansion }, [expansion])
    return null
  }
  let renderer!: ReturnType<typeof create>
  await act(() => { renderer = create(<Probe active="personal-chief" />) })
  try {
    assert.equal(state.expanded.has('personal-chief'), true)
    await act(() => state.toggle('personal-chief'))
    assert.equal(state.expanded.has('personal-chief'), false)
    await act(() => renderer.update(<Probe active="personal-chief" />))
    assert.equal(state.expanded.has('personal-chief'), false, 'ordinary rerenders preserve collapse')
    await act(() => state.toggle('personal-chief'))
    assert.equal(state.expanded.has('personal-chief'), true)
    await act(() => state.toggle('personal-chief'))

    await act(() => renderer.update(<Probe active="workspace-chief" />))
    assert.equal(state.expanded.has('workspace-chief'), true)
    assert.equal(state.expanded.has('personal-chief'), false)
    await act(() => state.toggle('workspace-chief'))
    assert.equal(state.expanded.has('workspace-chief'), false)
    await act(() => renderer.update(<Probe active={null} />))
    assert.equal(state.expanded.size, 0)
    await act(() => renderer.update(<Probe active="personal-chief" />))
    assert.equal(state.expanded.has('personal-chief'), true, 'return navigation reveals threads')
  } finally {
    await act(() => renderer.unmount())
  }
})
