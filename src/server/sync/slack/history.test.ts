import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SyncInboundEvent } from '@/shared/sync/types'
import { SyncLinkPausedError, SyncRateLimitedError } from '../adapters'
import { callSlackApi, readSlackHistoryPage, type SlackApiCall } from './history'

/** Shaped like Slack's documented conversations.history and conversations.replies responses. */
const historyPage1 = {
  ok: true,
  messages: [
    { type: 'message', user: 'U012AB3CDE', text: 'Shipping the beta <@U061F7AUR>', ts: '1762950000.000300', reply_count: 2, thread_ts: '1762950000.000300', latest_reply: '1762950100.000500' },
    { type: 'message', subtype: 'channel_join', user: 'U061F7AUR', text: '<@U061F7AUR> has joined the channel', ts: '1762940000.000200' },
    { type: 'message', subtype: 'bot_message', bot_id: 'B0123', text: 'Deploy finished', ts: '1762930000.000100', edited: { user: 'B0123', ts: '1762930500.000000' } },
  ],
  has_more: true,
  pin_count: 0,
  response_metadata: { next_cursor: 'bmV4dF90czoxNzYyOTMwMDAwMDAwMTAw' },
}
const historyPage2 = {
  ok: true,
  messages: [{ type: 'message', user: 'U061F7AUR', text: 'Older note', ts: '1762900000.000050' }],
  has_more: false,
  response_metadata: { next_cursor: '' },
}
const replies = {
  ok: true,
  messages: [
    { type: 'message', user: 'U012AB3CDE', text: 'Shipping the beta', ts: '1762950000.000300', thread_ts: '1762950000.000300', reply_count: 2 },
    { type: 'message', user: 'U061F7AUR', text: 'Nice!', ts: '1762950050.000400', thread_ts: '1762950000.000300', parent_user_id: 'U012AB3CDE' },
    { type: 'message', user: 'U012AB3CDE', text: 'Thanks', ts: '1762950100.000500', thread_ts: '1762950000.000300', parent_user_id: 'U012AB3CDE' },
  ],
  has_more: false,
}

function recorder(responses: Record<string, unknown[]>) {
  const calls: Array<[string, Record<string, string | number>]> = []
  const call: SlackApiCall = async (method, params) => {
    calls.push([method, params])
    const next = responses[method]?.shift()
    if (next instanceof Error) throw next
    return next as Awaited<ReturnType<SlackApiCall>>
  }
  return { calls, call }
}

const convert = async (events: SyncInboundEvent[]) => ({
  events: events.map(event => event.kind === 'message.upsert' ? { ...event, text: event.text.toUpperCase() } : event),
  authors: [{ externalUserId: 'U012AB3CDE', displayName: 'Ada' }],
})

test('history pages newest first back to the target, then imports each thread', async () => {
  const { calls, call } = recorder({ 'conversations.history': [historyPage1, historyPage2], 'conversations.replies': [replies] })
  const targetAt = 1_747_000_000_000
  const base = { call, convert, channelId: 'C1', targetAt, pageSize: 15 }

  const first = await readSlackHistoryPage(base)
  assert.deepEqual(calls[0], ['conversations.history', { channel: 'C1', limit: 15, oldest: '1747000000.000000' }])
  assert.deepEqual(first.events.map(event => event.kind === 'message.upsert' ? [event.externalMessageId, event.externalUserId, event.text, event.editedAt] : []), [
    ['1762950000.000300', 'U012AB3CDE', 'SHIPPING THE BETA <@U061F7AUR>', undefined],
    ['1762930000.000100', 'B0123', 'DEPLOY FINISHED', 1762930500000],
  ])
  assert.equal(first.oldestAt, 1762930000000)
  assert.equal(first.done, false)

  const second = await readSlackHistoryPage({ ...base, cursor: first.nextCursor })
  assert.equal(calls[1]![1].cursor, 'bmV4dF90czoxNzYyOTMwMDAwMDAwMTAw')
  assert.equal(calls[1]![1].oldest, '1747000000.000000')
  assert.equal(second.oldestAt, targetAt)
  assert.equal(second.done, false)

  const third = await readSlackHistoryPage({ ...base, cursor: second.nextCursor })
  assert.deepEqual(calls[2], ['conversations.replies', { channel: 'C1', ts: '1762950000.000300', limit: 15, oldest: '1747000000.000000' }])
  assert.deepEqual(third.events.map(event => event.kind === 'message.upsert' ? [event.externalMessageId, event.externalThreadId] : []), [
    ['1762950050.000400', '1762950000.000300'],
    ['1762950100.000500', '1762950000.000300'],
  ])
  assert.equal(third.done, true)
  assert.equal(third.nextCursor, undefined)
})

test('a deleted thread root is skipped instead of stopping the import', async () => {
  const missing = Object.assign(new Error('Slack conversations.replies failed: thread_not_found'), { data: { error: 'thread_not_found' } })
  const { call } = recorder({ 'conversations.replies': [missing, replies] })
  const cursor = JSON.stringify({ phase: 'replies', oldest: '1.000000', threads: ['9.000000', '1762950000.000300'] })
  const page = await readSlackHistoryPage({ call, convert, channelId: 'C1', cursor, targetAt: 1000, pageSize: 15 })
  assert.deepEqual(page.events, [])
  assert.equal(page.done, false)
  assert.deepEqual(JSON.parse(page.nextCursor!).threads, ['1762950000.000300'])
})

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const impl = (async (url: string, init: RequestInit) => {
    requests.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers })
  }) as unknown as typeof fetch
  return { impl, requests }
}

test('Slack calls send the bot token and form-encoded params', async () => {
  const { impl, requests } = fakeFetch(200, historyPage2)
  const result = await callSlackApi('xoxb-test', 'conversations.history', { channel: 'C1', limit: 15 }, impl)
  assert.equal(result.messages?.length, 1)
  assert.equal(requests[0]!.url, 'https://slack.com/api/conversations.history')
  assert.equal((requests[0]!.init.headers as Record<string, string>).Authorization, 'Bearer xoxb-test')
  assert.equal(String(requests[0]!.init.body), 'channel=C1&limit=15')
})

test('a 429 surfaces at once with its Retry-After', async () => {
  const { impl } = fakeFetch(429, { ok: false, error: 'ratelimited' }, { 'Retry-After': '30' })
  await assert.rejects(callSlackApi('xoxb-test', 'conversations.history', {}, impl), (error: unknown) => error instanceof SyncRateLimitedError && error.retryAfterMs === 30_000)
})

test('channel access errors pause the link and token errors reach the revocation check', async () => {
  await assert.rejects(callSlackApi('xoxb-test', 'conversations.history', {}, fakeFetch(200, { ok: false, error: 'not_in_channel' }).impl),
    (error: unknown) => error instanceof SyncLinkPausedError && error.reason === 'not_in_channel')
  await assert.rejects(callSlackApi('xoxb-test', 'conversations.history', {}, fakeFetch(200, { ok: false, error: 'token_revoked' }).impl),
    (error: unknown) => (error as { data?: { error?: string } }).data?.error === 'token_revoked')
})
