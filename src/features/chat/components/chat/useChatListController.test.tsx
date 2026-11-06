import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, useEffect } from 'react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { setActiveChatListWorkspace } from '@/shared/chat/chat-list-cache'
import { useChatListController } from './useChatListController'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}

test('a late legacy read and a retained setter cannot replace the next workspace list', async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
    setActiveChatListWorkspace(null)
  })
  let resolveRead!: (response: Response) => void
  t.mock.method(overlayAppClient.conversations, 'getResponse', () => new Promise<Response>(resolve => { resolveRead = resolve }))
  let controller!: ReturnType<typeof useChatListController>
  const pendingTitleRef = { current: null }
  function Probe({ workspaceId }: { workspaceId: string }) {
    const current = useChatListController({ userId: 'viewer', workspaceId, pendingTitleRef, initialChats: [] })
    useEffect(() => { controller = current }, [current])
    return null
  }
  setActiveChatListWorkspace('old-workspace')
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(<Probe workspaceId="old-workspace" />) })
  const oldSetter = controller.setChats
  let oldRequest!: Promise<void>
  await act(async () => { oldRequest = controller.loadChats() })
  try {
    setActiveChatListWorkspace('new-workspace')
    await act(async () => { renderer.update(<Probe workspaceId="new-workspace" />) })
    const current = { _id: 'current-chat', title: 'Current', workspaceId: 'new-workspace', lastModified: 2 }
    await act(async () => { controller.setChats([current]) })
    await act(async () => {
      resolveRead(Response.json({ data: [{ _id: 'old-chat', title: 'Old', lastModified: 1 }], hasMore: false }))
      await oldRequest
      oldSetter([])
    })
    assert.deepEqual(controller.chats, [current])
  } finally { await act(async () => { renderer.unmount() }) }
})
