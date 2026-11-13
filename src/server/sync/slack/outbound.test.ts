import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { SyncAccountRevokedError, SyncOutboundRejectedError, SyncRateLimitedError, type SyncLinkRef } from '../adapters'
import { slackOutboundAdapter, slackReactionName } from './outbound'

const link: SyncLinkRef = {
  linkId: 'link', workspaceId: 'ws', provider: 'slack', externalOrgId: 'T0123', externalChannelId: 'C0456', conversationId: 'conv',
}
const credential = { externalUserId: 'U0789', accessToken: 'xoxp-member-token' }
const realFetch = globalThis.fetch

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

function stubSlack(...responses: Array<{ status?: number; headers?: Record<string, string>; body: unknown }>) {
  const calls: Call[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    const next = responses.shift()!
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: next.headers })
  }) as typeof fetch
  return calls
}

afterEach(() => { globalThis.fetch = realFetch })

test('posts as the member in the thread and returns the new ts', async () => {
  const calls = stubSlack({
    body: {
      ok: true, channel: 'C0456', ts: '1731400000.000200',
      message: { type: 'message', user: 'U0789', text: 'hello *Slack*', ts: '1731400000.000200', thread_ts: '1731399000.000100' },
    },
  })
  const result = await slackOutboundAdapter.post(link, credential, { content: 'hello **Slack**', externalThreadId: '1731399000.000100' })
  assert.deepEqual(result, { externalMessageId: '1731400000.000200' })
  assert.equal(calls[0]!.url, 'https://slack.com/api/chat.postMessage')
  assert.equal(calls[0]!.headers.Authorization, 'Bearer xoxp-member-token')
  assert.equal(calls[0]!.body.channel, 'C0456')
  assert.equal(calls[0]!.body.thread_ts, '1731399000.000100')
  assert.equal(calls[0]!.body.unfurl_links, false)
  assert.ok(typeof calls[0]!.body.markdown_text === 'string' && (calls[0]!.body.markdown_text as string).includes('Slack'))
})

test('edits, deletes and reacts on the mapped ts', async () => {
  const calls = stubSlack(
    { body: { ok: true, channel: 'C0456', ts: '1731400000.000200', text: 'fixed' } },
    { body: { ok: false, error: 'message_not_found' } },
    { body: { ok: false, error: 'already_reacted' } },
    { body: { ok: true } },
  )
  await slackOutboundAdapter.edit(link, credential, '1731400000.000200', { content: 'fixed' })
  await slackOutboundAdapter.remove(link, credential, '1731400000.000200')
  await slackOutboundAdapter.react(link, credential, '1731400000.000200', '👍', true)
  await slackOutboundAdapter.react(link, credential, '1731400000.000200', ':partyparrot:', false)
  assert.deepEqual(calls.map(call => call.url.split('/').pop()), ['chat.update', 'chat.delete', 'reactions.add', 'reactions.remove'])
  assert.equal(calls[0]!.body.ts, '1731400000.000200')
  assert.deepEqual(calls[2]!.body, { channel: 'C0456', timestamp: '1731400000.000200', name: '+1' })
  assert.equal(calls[3]!.body.name, 'partyparrot')
})

test('Slack errors map to rate limits, revoked grants and permanent refusals', async () => {
  stubSlack({ status: 429, headers: { 'retry-after': '7' }, body: { ok: false, error: 'ratelimited' } })
  await assert.rejects(slackOutboundAdapter.post(link, credential, { content: 'x' }), (error: unknown) => error instanceof SyncRateLimitedError && error.retryAfterMs === 7000)
  stubSlack({ body: { ok: false, error: 'token_revoked' } })
  await assert.rejects(slackOutboundAdapter.post(link, credential, { content: 'x' }), SyncAccountRevokedError)
  stubSlack({ body: { ok: false, error: 'not_in_channel' } })
  await assert.rejects(slackOutboundAdapter.post(link, credential, { content: 'x' }), SyncOutboundRejectedError)
  stubSlack({ body: { ok: false, error: 'internal_error' } })
  await assert.rejects(slackOutboundAdapter.post(link, credential, { content: 'x' }), (error: unknown) => error instanceof Error && !(error instanceof SyncOutboundRejectedError))
})

test('reaction names come from the emoji, including variation selectors', async () => {
  assert.equal(await slackReactionName('🎉'), 'tada')
  assert.equal(await slackReactionName('❤️'), 'heart')
  assert.equal(await slackReactionName(':custom_one:'), 'custom_one')
  await assert.rejects(slackReactionName('not an emoji'), SyncOutboundRejectedError)
})
