import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SyncInboundEvent } from '@/shared/sync/types'
import { SyncLinkPausedError, SyncRateLimitedError, type SyncHistoryAdapter, type SyncHistoryPage } from './adapters'
import { runSyncHistoryTick, type SyncHistoryWork } from './history-worker'
import { SyncBudgetExhaustedError } from './rate-limit'

process.env.INTERNAL_API_SECRET = 'sync-test-secret'

const link = { linkId: 'l1', workspaceId: 'ws', provider: 'slack' as const, externalOrgId: 'T1', externalChannelId: 'C1', conversationId: 'c1' }
const upsert = (id: string, editedAt?: number): SyncInboundEvent => ({
  kind: 'message.upsert', externalMessageId: id, externalUserId: 'U1', text: id, createdAt: 1000, ...(editedAt ? { editedAt } : {}),
})

function harness(work: SyncHistoryWork[], pages: Array<SyncHistoryPage | Error>, mapped: string[] = []) {
  const calls: Array<[string, Record<string, unknown>]> = []
  const requests: Array<Record<string, unknown>> = []
  const convex = {
    mutation: (async (path: string, args: Record<string, unknown>) => {
      calls.push([path, Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'serverSecret'))])
      if (path === 'sync/history:claimWork') return work
      if (path === 'sync/ingest:isMapped') return mapped
      return null
    }) as never,
  }
  const adapter: SyncHistoryAdapter = {
    provider: 'slack',
    fetchHistoryPage: async (_link, args) => {
      requests.push(args)
      const next = pages.shift()
      if (!next || next instanceof Error) throw next ?? new SyncBudgetExhaustedError(60_000)
      return next
    },
  }
  return { calls, requests, deps: { convex, adapters: { slack: adapter }, now: () => 5_000, deadlineAt: 10_000 } }
}

const authors = [{ externalUserId: 'U1', displayName: 'Ada' }]

test('history resumes from the saved cursor, applies each page and finishes into syncing', async () => {
  const { calls, requests, deps } = harness(
    [{ mode: 'history', link: { ...link, historyTargetAt: 100, historyCursor: 'c0', historyOldestAt: 4000 } }],
    [
      { events: [upsert('3'), upsert('2')], authors, nextCursor: 'c1', oldestAt: 2000, done: false },
      { events: [upsert('1')], authors, oldestAt: 100, done: true },
    ],
  )
  assert.deepEqual(await runSyncHistoryTick(deps), { links: 1, pages: 2 })
  assert.deepEqual(requests, [{ cursor: 'c0', targetAt: 100, priority: 'history' }, { cursor: 'c1', targetAt: 100, priority: 'history' }])
  assert.deepEqual(calls.slice(1).map(([path, args]) => [path, path === 'sync/ingest:applyInbound' ? (args.batch as { events: SyncInboundEvent[] }).events.length : args]), [
    ['sync/ingest:applyInbound', 2],
    ['sync/links:updateLinkState', { linkId: 'l1', historyCursor: 'c1', historyOldestAt: 2000 }],
    ['sync/ingest:applyInbound', 1],
    ['sync/links:updateLinkState', { linkId: 'l1', historyCursor: null, historyOldestAt: 100, historyCompletedAt: 5000 }],
    ['sync/history:updateWork', { linkId: 'l1', completeHistory: true }],
    ['sync/history:updateWork', { linkId: 'l1', release: true }],
  ])
})

test('repair applies only messages we are missing or that were edited, then records the repair', async () => {
  const { calls, requests, deps } = harness(
    [{ mode: 'repair', link: { ...link, historyCursor: 'ignored' } }],
    [{ events: [upsert('a'), upsert('b'), upsert('c', 3000)], authors, done: true }],
    ['a', 'c'],
  )
  await runSyncHistoryTick(deps)
  assert.deepEqual(requests, [{ targetAt: 5_000 - 24 * 60 * 60 * 1000, priority: 'repair' }])
  const applied = calls.find(([path]) => path === 'sync/ingest:applyInbound')![1].batch as { events: Array<{ externalMessageId: string }>; authors: unknown[] }
  assert.deepEqual(applied.events.map(event => event.externalMessageId), ['b', 'c'])
  assert.deepEqual(applied.authors, authors)
  assert.deepEqual(calls.slice(-2), [
    ['sync/history:updateWork', { linkId: 'l1', repairCursor: null, repairedAt: 5000 }],
    ['sync/history:updateWork', { linkId: 'l1', release: true }],
  ])
})

test('a platform 429 shows Catching up; a paused channel says why; an empty budget just waits', async () => {
  const limited = harness([{ mode: 'history', link }], [new SyncRateLimitedError(30_000)])
  await runSyncHistoryTick(limited.deps)
  assert.deepEqual(limited.calls.slice(1), [
    ['sync/links:updateLinkState', { linkId: 'l1', status: 'catching_up', catchUpUntil: 35_000 }],
    ['sync/history:updateWork', { linkId: 'l1', release: true }],
  ])
  const paused = harness([{ mode: 'repair', link }], [new SyncLinkPausedError('not_in_channel')])
  await runSyncHistoryTick(paused.deps)
  assert.deepEqual(paused.calls[1], ['sync/links:updateLinkState', { linkId: 'l1', status: 'paused', pauseReason: 'not_in_channel' }])
  const waiting = harness([{ mode: 'history', link }], [])
  assert.deepEqual(await runSyncHistoryTick(waiting.deps), { links: 1, pages: 0 })
  assert.deepEqual(waiting.calls.slice(1), [['sync/history:updateWork', { linkId: 'l1', release: true }]])
})

test('links whose provider has no history adapter yet are released untouched', async () => {
  const { calls, deps } = harness([{ mode: 'history', link: { ...link, provider: 'teams' } }], [])
  assert.deepEqual(await runSyncHistoryTick(deps), { links: 1, pages: 0 })
  assert.deepEqual(calls.slice(1), [['sync/history:updateWork', { linkId: 'l1', release: true }]])
})
