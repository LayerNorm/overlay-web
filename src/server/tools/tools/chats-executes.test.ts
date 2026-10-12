import assert from 'node:assert/strict'
import test from 'node:test'
import { executeListChats, executeReadChat } from './chats-executes'
import type { OverlayToolsOptions } from './types'

const options = { userId: 'user', workspaceId: 'w', baseUrl: 'http://app.test' } as OverlayToolsOptions

function withFetch(handler: (url: URL) => unknown, run: () => Promise<void>) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const body = handler(new URL(String(input)))
    return new Response(JSON.stringify(body), { status: body === null ? 404 : 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return run().finally(() => { globalThis.fetch = original })
}

const chats = [
  { _id: 'c1', title: 'Chemotherapy Cost Factors Explained', conversationType: 'personal', updatedAt: 30 },
  { _id: 'c2', title: 'How to Find Bugs', conversationType: 'personal', updatedAt: 20 },
  { _id: 'c3', title: 'Bugs in billing', conversationType: 'dm', updatedAt: 10 },
]

test('list_chats filters by title and puts the newest first', async () => {
  await withFetch(() => ({ data: chats, hasMore: false }), async () => {
    const result = await executeListChats(options, { query: 'bugs' }) as { chats: Array<{ chatId: string }> }
    assert.deepEqual(result.chats.map((chat) => chat.chatId), ['c2', 'c3'])
  })
})

test('read_chat finds a chat by title and returns its messages oldest first, labeled by speaker', async () => {
  await withFetch((url) => url.searchParams.get('conversationId')
    ? { title: 'Chemotherapy Cost Factors Explained', messages: [
        { id: 'm2', role: 'assistant', authorKind: 'agent', createdAt: 2000, parts: [{ type: 'text', text: 'It depends on the regimen.' }] },
        { id: 'm1', role: 'user', authorKind: 'human', createdAt: 1000, parts: [{ type: 'text', text: 'What drives cost?' }] },
      ] }
    : { data: chats, hasMore: false }, async () => {
    const result = await executeReadChat(options, { title: 'chemotherapy cost factors explained' }) as { success: boolean; messages: Array<{ from: string; text: string }> }
    assert.equal(result.success, true)
    assert.deepEqual(result.messages.map((message) => [message.from, message.text]), [['user', 'What drives cost?'], ['assistant', 'It depends on the regimen.']])
  })
})

test('read_chat asks which chat when several match, and says so when none does', async () => {
  await withFetch(() => ({ data: chats, hasMore: false }), async () => {
    const several = await executeReadChat(options, { title: 'bugs' }) as { success: boolean; candidates?: unknown[] }
    assert.equal(several.success, false)
    assert.equal(several.candidates?.length, 2)
    const none = await executeReadChat(options, { title: 'tax return' }) as { success: boolean; error: string }
    assert.equal(none.success, false)
    assert.match(none.error, /list_chats/)
  })
})
