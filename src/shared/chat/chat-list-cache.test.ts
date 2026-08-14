import assert from 'node:assert/strict'
import test from 'node:test'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  clearAllChatListCaches,
  clearChatListCache,
  consumeNewEmptyChat,
  fetchChatListResult,
  markNewEmptyChat,
  setActiveChatListView,
  setActiveChatListWorkspace,
} from './chat-list-cache'

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
