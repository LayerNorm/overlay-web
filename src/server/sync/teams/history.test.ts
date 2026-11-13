import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SyncRateLimitedError, type SyncLinkRef } from '@/server/sync/adapters'
import { teamsHistoryAdapter } from './history'

process.env.MICROSOFT_SYNC_CLIENT_ID = 'client-id'
process.env.MICROSOFT_SYNC_CLIENT_SECRET = 'client-secret'

const page = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'channel-messages-with-replies.json'), 'utf8')) as {
  '@odata.nextLink': string
  value: Array<{ id: string; createdDateTime: string; 'replies@odata.nextLink': string; replies: Array<{ id: string }> }>
}
const root = page.value[0]!
const reply = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'channel-reply.json'), 'utf8')) as Record<string, unknown>

const link: SyncLinkRef = {
  linkId: 'link1', workspaceId: 'ws', provider: 'teams', externalOrgId: 'tenant-history',
  externalChannelId: '19:4a95f7d8db4c4e7fae857bcebe0623e6@thread.tacv2', externalGroupId: 'fbe2bf47-16c8-47cf-b4a5-4b9b187c508b', conversationId: 'c1',
}

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function mockGraph(routes: (url: string) => Response | undefined) {
  const calls: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('login.microsoftonline.com')) return Response.json({ access_token: 'app-token', expires_in: 3600 })
    if (url.includes('/users/')) return Response.json({ error: { code: 'Request_ResourceNotFound' } }, { status: 404 })
    return routes(url) ?? Response.json({ error: { code: 'NotFound' } }, { status: 404 })
  }) as typeof fetch
  return calls
}

test('a recorded page with replies becomes root-first events, follows reply paging, and pages on', async () => {
  const calls = mockGraph(url => {
    if (url === root['replies@odata.nextLink']) return Response.json({ value: [{ ...reply, id: '1616999999999', replyToId: root.id, createdDateTime: '2021-03-30T00:00:00Z' }] })
    if (url.includes('/messages?$top=50&$expand=replies')) return Response.json(page)
    return undefined
  })
  const result = await teamsHistoryAdapter.fetchHistoryPage(link, { targetAt: Date.parse('2021-01-01T00:00:00Z') })
  assert.ok(calls.some(url => url.startsWith('https://graph.microsoft.com/v1.0/teams/fbe2bf47-16c8-47cf-b4a5-4b9b187c508b/channels/19%3A4a95f7d8db4c4e7fae857bcebe0623e6%40thread.tacv2/messages?')))
  const upserts = result.events.filter(event => event.kind === 'message.upsert')
  assert.equal(upserts[0]?.externalMessageId, root.id)
  assert.deepEqual(upserts.slice(1).map(event => event.externalMessageId), [
    ...root.replies.map(entry => root.id + '/' + entry.id).sort(),
    root.id + '/1616999999999',
  ])
  assert.ok(upserts.slice(1).every(event => event.kind === 'message.upsert' && event.externalThreadId === root.id))
  assert.equal(result.nextCursor, page['@odata.nextLink'])
  assert.equal(result.done, false)
  assert.equal(result.oldestAt, Date.parse(root.createdDateTime))
  assert.ok(result.authors.some(author => author.displayName === 'Robin Kline'))
})

test('a page past the 180-day target stops and reports done', async () => {
  mockGraph(url => url.includes('$skiptoken') ? undefined : Response.json(page))
  const result = await teamsHistoryAdapter.fetchHistoryPage(link, { cursor: 'https://graph.microsoft.com/v1.0/teams/x/channels/y/messages?$top=50', targetAt: Date.parse('2030-01-01T00:00:00Z') })
  assert.deepEqual(result.events, [])
  assert.equal(result.done, true)
  assert.equal(result.nextCursor, undefined)
})

test('Graph throttling maps Retry-After to SyncRateLimitedError', async () => {
  mockGraph(() => new Response('{}', { status: 429, headers: { 'Retry-After': '7' } }))
  await assert.rejects(
    teamsHistoryAdapter.fetchHistoryPage(link, { targetAt: 0 }),
    (error: unknown) => error instanceof SyncRateLimitedError && error.retryAfterMs === 7000,
  )
})

test('a cursor that is not a Graph URL is refused', async () => {
  mockGraph(() => undefined)
  await assert.rejects(teamsHistoryAdapter.fetchHistoryPage(link, { cursor: 'https://evil.example/steal', targetAt: 0 }), /non-Graph URL/)
})
