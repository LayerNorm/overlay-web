import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import { act, create } from 'react-test-renderer'
import { NativeWorkspaceHeadcounts } from './NativeWorkspaceHeadcounts'
import type { WorkspaceSummary } from '@/shared/workspaces/types'

test('real Convex subscriptions settle while membership pages load and revoke', async () => {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  const listeners = new Set<() => void>()
  type Page = {
    page: Array<{ memberCount: number; humanMemberCount: number }>
    isDone: boolean
    continueCursor: string
  }
  const pages = new Map<string | null, Page>()
  const client = {
    watchQuery(_query: unknown, args: { paginationOpts: { cursor: string | null } }) {
      return {
        localQueryResult: () => pages.get(args.paginationOpts.cursor),
        onUpdate(callback: () => void) {
          listeners.add(callback)
          return () => { listeners.delete(callback) }
        },
      }
    },
  } as unknown as ConvexReactClient
  const workspaces: WorkspaceSummary[] = [{
    id: 'workspace-a', name: 'Workspace A', slug: 'workspace-a',
    kind: 'organization', status: 'active', role: 'owner', updatedAt: 1,
  }]
  const renders: Array<readonly WorkspaceSummary[]> = []
  function Probe({ value }: { value: readonly WorkspaceSummary[] }) {
    React.useLayoutEffect(() => { renders.push(value) })
    return null
  }
  const tree = (rows: readonly WorkspaceSummary[]) => (
    <ConvexProvider client={client}>
      <NativeWorkspaceHeadcounts workspaces={rows}>
        {value => <Probe value={value} />}
      </NativeWorkspaceHeadcounts>
    </ConvexProvider>
  )
  let root!: ReturnType<typeof create>
  try {
    await act(async () => { root = create(tree(workspaces)) })
    assert.equal(renders.at(-1)?.[0].humanMemberCount, undefined)
    await act(async () => {
      pages.set(null, {
        page: Array.from({ length: 100 }, () => ({ memberCount: 1, humanMemberCount: 1 })),
        isDone: false, continueCursor: 'next',
      })
      for (const listener of listeners) listener()
    })
    assert.equal(renders.at(-1)?.[0].humanMemberCount, undefined)
    await act(async () => {
      pages.set('next', {
        page: [{ memberCount: 1, humanMemberCount: 1 }], isDone: true, continueCursor: '',
      })
      for (const listener of listeners) listener()
    })
    assert.equal(renders.at(-1)?.[0].humanMemberCount, 101)
    assert.ok(renders.every(rows => rows[0]?.humanMemberCount === undefined
      || rows[0].humanMemberCount === 101))
    await act(async () => {
      pages.set(null, {
        page: [{ memberCount: 1, humanMemberCount: 1 }], isDone: true, continueCursor: '',
      })
      for (const listener of listeners) listener()
    })
    assert.equal(renders.at(-1)?.[0].humanMemberCount, 1)
    assert.equal(renders.at(-1)?.[0].memberCount, 1)
    await act(async () => { root.update(tree([])) })
    assert.deepEqual(renders.at(-1), [])
  } finally {
    if (root) await act(async () => root.unmount())
  }
  assert.equal(listeners.size, 0)
})
