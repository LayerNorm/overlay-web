import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test, { type TestContext } from 'node:test'
import React, { act, useEffect, useState } from 'react'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import type { ThreadActivity } from '@/shared/agents/thread-activity'
import { AgentThreadRows } from '../AppSidebarAgentThreads'
import { useLiveAgentBundle } from './useLiveAgentBundle'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): {
    update(element: React.ReactElement): void
    unmount(): void
    toJSON(): unknown
  }
}
;(globalThis as typeof globalThis & { React: typeof React }).React = React

const bundle = (ids: string[]): WorkspaceAgentBundle => ({
  threads: ids.map((id, index) => ({ conversationId: id, title: `Thread ${id}`, isMain: index === 0,
    createdAt: index, lastModified: index })),
  automations: [],
})
const activity = (ids: string[]): ThreadActivity[] => ids.map(conversationId => ({ conversationId, status: 'idle' }))
type Bundle = WorkspaceAgentBundle | 'loading' | 'error'
type Props = { activity?: ThreadActivity[]; expanded: boolean }

async function setup(t: TestContext, initial: Bundle, props: Props) {
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  let current: Bundle = initial
  let remote: Bundle = initial
  let updateBundle!: (next: Bundle) => void
  const refresh = t.mock.fn(async () => updateBundle(remote))
  function Probe(props: Props) {
    const [cached, setCached] = useState(initial)
    useEffect(() => { current = cached; updateBundle = setCached }, [cached])
    useLiveAgentBundle({ agentId: 'agent', bundle: cached, expanded: props.expanded, activity: props.activity, refresh })
    return props.expanded ? <AgentThreadRows
      agent={{ id: 'agent', name: 'Specialist' } as WorkspaceAgentDirectoryItem}
      bundle={cached} activeConversationId={null}
      onOpenThread={() => {}} onOpenAutomation={() => {}} onArchiveThread={() => {}} onDeleteThread={() => {}}
    /> : null
  }
  let renderer!: ReturnType<typeof create>
  await act(() => { renderer = create(<Probe {...props} />) })
  t.after(async () => {
    await act(() => renderer.unmount())
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  return {
    refresh,
    current: () => current,
    markup: () => JSON.stringify(renderer.toJSON()),
    remote: (next: Bundle) => { remote = next },
    cached: async (next: Bundle) => { await act(() => updateBundle(next)) },
    render: async (next: Props) => { await act(() => renderer.update(<Probe {...next} />)) },
  }
}

test('a newly assigned thread appears in an already-expanded list without a remount', async t => {
  const h = await setup(t, bundle(['main']), { expanded: true, activity: activity(['main']) })
  assert.equal(h.refresh.mock.callCount(), 0)
  assert.doesNotMatch(h.markup(), /Thread assignment/)
  h.remote(bundle(['assignment', 'main']))
  await h.render({ expanded: true, activity: activity(['main', 'assignment']) })
  assert.equal(h.refresh.mock.callCount(), 1)
  assert.match(h.markup(), /Thread assignment/)
  await h.render({ expanded: true, activity: [{ conversationId: 'assignment', status: 'completed' },
    { conversationId: 'main', status: 'working' }] })
  assert.equal(h.refresh.mock.callCount(), 1, 'status changes and query ordering do not refetch a bundle')
  h.remote(bundle(['main']))
  await h.render({ expanded: true, activity: activity(['main']) })
  assert.doesNotMatch(h.markup(), /Thread assignment/)
  assert.equal(h.refresh.mock.callCount(), 2)
})

test('collapsed lists defer refresh until expanded; absent realtime data keeps the HTTP fallback', async t => {
  const h = await setup(t, bundle(['main']), { expanded: false })
  h.remote(bundle(['main', 'assignment']))
  await h.render({ expanded: false, activity: activity(['main', 'assignment']) })
  assert.equal(h.refresh.mock.callCount(), 0)
  await h.render({ expanded: true, activity: activity(['main', 'assignment']) })
  assert.match(h.markup(), /Thread assignment/)
  assert.equal(h.refresh.mock.callCount(), 1)
  await h.render({ expanded: true })
  assert.match(h.markup(), /Thread assignment/)
  assert.equal(h.refresh.mock.callCount(), 1)
})

test('empty projections refresh removals and failed refreshes do not loop', async t => {
  const h = await setup(t, bundle(['main']), { expanded: true, activity: activity(['main']) })
  h.remote('error')
  await h.render({ expanded: true, activity: activity(['main', 'assignment']) })
  assert.equal(h.current(), 'error')
  assert.match(h.markup(), /Could not load threads/)
  await h.render({ expanded: true, activity: activity(['main', 'assignment']) })
  assert.equal(h.refresh.mock.callCount(), 1)
  h.remote(bundle([]))
  await h.render({ expanded: true, activity: [] })
  assert.deepEqual(h.current(), bundle([]))
  assert.equal(h.refresh.mock.callCount(), 2)
})

test('a query update during the initial fetch is reconciled after that fetch settles', async t => {
  const h = await setup(t, 'loading', { expanded: true, activity: activity(['main']) })
  h.remote(bundle(['main', 'assignment']))
  await h.render({ expanded: true, activity: activity(['main', 'assignment']) })
  assert.equal(h.refresh.mock.callCount(), 0)
  await h.cached(bundle(['main']))
  assert.equal(h.refresh.mock.callCount(), 1)
  assert.match(h.markup(), /Thread assignment/)
})
