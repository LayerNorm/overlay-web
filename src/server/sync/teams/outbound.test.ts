import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SyncRateLimitedError, type SyncLinkRef } from '@/server/sync/adapters'
import { teamsOutboundAdapter } from './outbound'

const link: SyncLinkRef = {
  linkId: 'link1', workspaceId: 'ws', provider: 'teams', externalOrgId: 'tenant',
  externalChannelId: '19:abc@thread.tacv2', externalGroupId: 'team-1', conversationId: 'c1',
}
const credential = { externalUserId: 'user-1', accessToken: 'member-token' }
const channel = 'https://graph.microsoft.com/v1.0/teams/team-1/channels/19%3Aabc%40thread.tacv2/messages'
const reply = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'channel-reply.json'), 'utf8')) as Record<string, unknown>

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function record(response: () => Response) {
  const calls: Array<{ url: string; method: string; auth: string | null; body: unknown }> = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      auth: new Headers(init?.headers).get('Authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return response()
  }) as typeof fetch
  return calls
}

test('a top-level post goes out as the member in HTML', async () => {
  const calls = record(() => Response.json({ id: '1700000000000' }, { status: 201 }))
  const result = await teamsOutboundAdapter.post(link, credential, { content: 'Ship **today**' })
  assert.deepEqual(result, { externalMessageId: '1700000000000' })
  assert.deepEqual(calls, [{ url: channel, method: 'POST', auth: 'Bearer member-token', body: { body: { contentType: 'html', content: '<p>Ship <strong>today</strong></p>' } } }])
})

test('a thread reply posts under the root and returns the root/reply key inbound sync uses', async () => {
  const calls = record(() => Response.json(reply, { status: 201 }))
  const result = await teamsOutboundAdapter.post(link, credential, { content: 'Test', externalThreadId: '1612509044972' })
  assert.equal(calls[0]?.url, channel + '/1612509044972/replies')
  assert.deepEqual(result, { externalMessageId: '1612509044972/1613671348387' })
})

test('edits, deletes and reactions address replies through their root', async () => {
  const calls = record(() => new Response(null, { status: 204 }))
  await teamsOutboundAdapter.edit(link, credential, '100/200', { content: 'fixed' })
  await teamsOutboundAdapter.remove(link, credential, '100')
  await teamsOutboundAdapter.react(link, credential, '100/200', '👍', true)
  await teamsOutboundAdapter.react(link, credential, '100', '🎉', false)
  assert.deepEqual(calls.map(call => [call.method, call.url.replace(channel, '')]), [
    ['PATCH', '/100/replies/200'],
    ['POST', '/100/softDelete'],
    ['POST', '/100/replies/200/setReaction'],
    ['POST', '/100/unsetReaction'],
  ])
  assert.deepEqual(calls[2]?.body, { reactionType: '👍' })
})

test('throttling surfaces as SyncRateLimitedError', async () => {
  record(() => new Response('{}', { status: 429, headers: { 'Retry-After': '3' } }))
  await assert.rejects(teamsOutboundAdapter.post(link, credential, { content: 'x' }), (error: unknown) => error instanceof SyncRateLimitedError && error.retryAfterMs === 3000)
})
