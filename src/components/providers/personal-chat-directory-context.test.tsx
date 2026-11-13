import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, memo } from 'react'
import { PersonalChatDirectoryProvider, usePersonalChatDirectory, type PersonalChatDirectoryValue } from './personal-chat-directory-context'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}

test('stream-only parent updates do not notify directory consumers; real list and access changes do', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', original)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  let renders = 0
  let observed: PersonalChatDirectoryValue | undefined
  const Consumer = memo(function Consumer() {
    observed = usePersonalChatDirectory()
    renders++
    return null
  })
  const list: PersonalChatDirectoryValue['active'] = { rows: [], status: 'ready', hasMore: false, loadingMore: false, loadMore() {} }
  const value: PersonalChatDirectoryValue = {
    available: true, workspaceId: 'workspace-a', viewerUserId: 'viewer', selectedConversationId: 'chat',
    selectedSummary: null, active: list, archived: list,
    rename: async () => {}, setArchived: async () => {}, setRead: async () => {},
  }
  const render = (next: PersonalChatDirectoryValue) => <PersonalChatDirectoryProvider value={next}><Consumer /></PersonalChatDirectoryProvider>
  let tree!: ReturnType<typeof create>
  await act(async () => { tree = create(render(value)) })
  try {
    const initial = renders
    for (let token = 0; token < 10; token++) {
      await act(async () => tree.update(render({ ...value })))
    }
    assert.equal(renders, initial)
    const loading = { ...value, active: { ...list, loadingMore: true } }
    await act(async () => tree.update(render(loading)))
    assert.equal(renders, initial + 1)
    assert.equal(observed?.active.loadingMore, true)
    await act(async () => tree.update(render({ ...value, workspaceId: 'workspace-b', available: false })))
    assert.equal(renders, initial + 2)
    assert.equal(observed?.workspaceId, 'workspace-b')
    assert.equal(observed?.available, false)
  } finally {
    await act(async () => tree.unmount())
  }
})
