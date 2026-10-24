import assert from 'node:assert/strict'
import test from 'node:test'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  clearAllChatListCaches,
  clearChatListCache,
  consumeNewEmptyChat,
  fetchChatListResult,
  fetchNextChatListPage,
  getCachedChatList,
  markNewEmptyChat,
  setActiveChatListView,
  setActiveChatListWorkspace,
} from './chat-list-cache'

test('chat cache requests keep their workspace across navigation, late replies and pagination', async (t) => {
  clearAllChatListCaches()
  setActiveChatListWorkspace('personal-id')
  setActiveChatListView('all')
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: new URL('https://app.example/w/old-org/workspace/chat') },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
    clearAllChatListCaches()
    setActiveChatListWorkspace(null)
    setActiveChatListView('personal')
  })
  const first = Promise.withResolvers<Response>()
  const targets: Array<string | null> = []
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    targets.push(new Headers(init?.headers).get('x-overlay-route-workspace'))
    if (targets.length === 1) return first.promise
    return Response.json({ data: [{ _id: 'page2', title: 'Personal 2', lastModified: 2 }], hasMore: false })
  })
  const pending = fetchChatListResult({ force: true })
  setActiveChatListWorkspace('old-org-id')
  first.resolve(Response.json({
    data: [{ _id: 'page1', title: 'Personal 1', lastModified: 1 }], hasMore: true, nextCursor: 'next',
  }))
  assert.equal((await pending).status, 'success')
  assert.equal(getCachedChatList(), null)
  setActiveChatListWorkspace('personal-id')
  assert.equal(getCachedChatList()?.[0]._id, 'page1')
  assert.deepEqual((await fetchNextChatListPage()).map((chat) => chat._id), ['page2', 'page1'])
  assert.deepEqual(targets, ['id:personal-id', 'id:personal-id'])
})

test('new empty chat markers are consumed exactly once', () => {
  clearChatListCache()
  const chat = { _id: 'chat_1', title: 'New Chat', lastModified: 1 }
  markNewEmptyChat(chat)
  assert.deepEqual(consumeNewEmptyChat('chat_1'), chat)
  assert.equal(consumeNewEmptyChat('chat_1'), null)
})

test('forced chat-list refreshes share the same in-flight request', async (t) => {
  clearAllChatListCaches()
  setActiveChatListWorkspace('workspace_1')
  setActiveChatListView('personal')
  t.after(clearAllChatListCaches)

  let requests = 0
  let releaseRequest!: () => void
  const pending = new Promise<void>((resolve) => { releaseRequest = resolve })
  t.mock.method(overlayAppClient.conversations, 'getResponse', async () => {
    requests += 1
    await pending
    return Response.json({ data: [], hasMore: false })
  })

  const first = fetchChatListResult({ force: true })
  const second = fetchChatListResult({ force: true })
  assert.equal(requests, 1)

  releaseRequest()
  assert.deepEqual(await first, { status: 'success', chats: [] })
  assert.deepEqual(await second, { status: 'success', chats: [] })
})

test('a 429 response creates a shared Retry-After cooldown', async (t) => {
  clearAllChatListCaches()
  setActiveChatListWorkspace('workspace_1')
  setActiveChatListView('personal')
  t.after(clearAllChatListCaches)

  let requests = 0
  t.mock.method(overlayAppClient.conversations, 'getResponse', async () => {
    requests += 1
    return new Response(null, {
      status: 429,
      headers: { 'Retry-After': '60' },
    })
  })

  const first = await fetchChatListResult({ force: true })
  const second = await fetchChatListResult({ force: true })

  assert.equal(first.status, 'rate-limited')
  assert.equal(second.status, 'rate-limited')
  assert.equal(requests, 1)
  if (second.status === 'rate-limited') {
    assert.ok(second.retryAfterMs > 59_000 && second.retryAfterMs <= 60_000)
  }
})
