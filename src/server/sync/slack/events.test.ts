import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleSlackSyncNotice, parseSlackSyncNotice } from './events'

process.env.INTERNAL_API_SECRET = 'sync-test-secret'

/** Payloads as documented for the Events API (app_rate_limited is top level, channel_created is an event_callback). */
const rateLimited = JSON.stringify({ token: 'Jhj5dZrVaK7ZwHHjRyZWjbDl', type: 'app_rate_limited', team_id: 'T123ABC456', minute_rate_limited: 1518467820, api_app_id: 'A123ABC456' })
const created = (channel: Record<string, unknown>) => JSON.stringify({
  token: 'x', team_id: 'T123ABC456', api_app_id: 'A123ABC456', type: 'event_callback', event_id: 'Ev1', event_time: 1360782400,
  event: { type: 'channel_created', channel: { id: 'C024BE91L', name: 'fun', created: 1360782804, creator: 'U024BE7LH', ...channel } },
})

test('app_rate_limited catches up after the rate-limited minute, never sooner than a minute from now', () => {
  assert.deepEqual(parseSlackSyncNotice(rateLimited, 1518467830000), { kind: 'app_rate_limited', teamId: 'T123ABC456', catchUpUntil: 1518467890000 })
  assert.deepEqual(parseSlackSyncNotice(rateLimited, 1518467900000), { kind: 'app_rate_limited', teamId: 'T123ABC456', catchUpUntil: 1518467960000 })
})

test('only new public channels are auto-link candidates', () => {
  assert.deepEqual(parseSlackSyncNotice(created({})), { kind: 'channel_created', teamId: 'T123ABC456', channelId: 'C024BE91L', name: 'fun' })
  assert.equal(parseSlackSyncNotice(created({ is_private: true })), null)
  assert.equal(parseSlackSyncNotice(JSON.stringify({ type: 'event_callback', team_id: 'T1', event: { type: 'message', channel: 'C1' } })), null)
  assert.equal(parseSlackSyncNotice('nope'), null)
})

function fakeConvex(result: unknown) {
  const calls: Array<[string, Record<string, unknown>]> = []
  return { calls, convex: { mutation: (async (path: string, args: Record<string, unknown>) => { calls.push([path, args]); return result }) as never } }
}

test('a rate-limit notice marks the team catching up', async () => {
  const { calls, convex } = fakeConvex(3)
  await handleSlackSyncNotice({ kind: 'app_rate_limited', teamId: 'T1', catchUpUntil: 99 }, { convex })
  assert.deepEqual(calls, [['sync/history:markCatchingUp', { serverSecret: 'sync-test-secret', provider: 'slack', externalOrgId: 'T1', catchUpUntil: 99 }]])
})

test('an auto-linked channel is joined so its messages arrive; an ignored one is not', async () => {
  const joined: string[] = []
  const joinChannel = async (_teamId: string, channelId: string) => { joined.push(channelId) }
  const notice = { kind: 'channel_created', teamId: 'T1', channelId: 'C9', name: 'launch' } as const
  const linked = fakeConvex({ linkId: 'l1' })
  await handleSlackSyncNotice(notice, { convex: linked.convex, joinChannel })
  assert.equal(linked.calls[0]![0], 'sync/autoLink:channelCreated')
  assert.deepEqual(joined, ['C9'])
  await handleSlackSyncNotice(notice, { convex: fakeConvex(null).convex, joinChannel })
  assert.deepEqual(joined, ['C9'])
})
