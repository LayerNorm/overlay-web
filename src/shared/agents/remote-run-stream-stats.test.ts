import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_TRACKED_OPEN_TOOLS,
  recordAcceptedBatch,
  recordRejectedBatch,
  summarizeRemoteRunStreamStats,
} from './remote-run-stream-stats'

const action = (actionId: string, status: string, occurredAt: number, title = 'Tool') =>
  ({ type: 'action', occurredAt, payload: { actionId, title, status } })

test('a cumulative-checkpoint stream shows its amplification against the final text', () => {
  let stats
  let text = ''
  for (let index = 0; index < 50; index += 1) {
    text += 'x'.repeat(20)
    stats = recordAcceptedBatch(stats, { events: [{ type: 'text_checkpoint', occurredAt: index, payload: { text } }], bytes: 100, now: index, wroteMessage: true })
  }
  assert.equal(stats!.messageWrites, 50)
  assert.equal(stats!.textCheckpointChars, 20 * (50 * 51) / 2) // 25x the 1,000 characters actually shown
})

test('tool time is measured from the host clock across batches, and only finished tools count', () => {
  let stats = recordAcceptedBatch(undefined, { events: [action('a', 'started', 100, 'Search'), action('b', 'started', 150)], bytes: 1, now: 200, wroteMessage: true })
  stats = recordAcceptedBatch(stats, { events: [action('a', 'completed', 4_100, 'Search')], bytes: 1, now: 4_200, wroteMessage: true })
  assert.equal(stats.longestToolMs, 4_000)
  assert.equal(stats.longestToolTitle, 'Search')
  assert.deepEqual(stats.openTools.map((tool) => tool.actionId), ['b'])
  assert.equal(stats.maxQuietGapMs, 4_000)
  assert.equal(stats.maxHostLagMs, 100)
})

test('open tools stay bounded and rejected batches are counted separately', () => {
  const events = Array.from({ length: MAX_TRACKED_OPEN_TOOLS + 5 }, (_, index) => action(`t${index}`, 'started', index))
  const stats = recordRejectedBatch(recordAcceptedBatch(undefined, { events, bytes: 1, now: 100, wroteMessage: false }))
  assert.equal(stats.openTools.length, MAX_TRACKED_OPEN_TOOLS)
  assert.equal(stats.openTools.at(-1)?.actionId, `t${MAX_TRACKED_OPEN_TOOLS + 4}`)
  assert.equal(stats.rejectedBatches, 1)
  assert.equal(stats.messageWrites, 0)
})

test('the summary reports silence and a still-running tool while the run is active', () => {
  const stats = recordAcceptedBatch(undefined, { events: [action('a', 'started', 1_000, 'Long fetch')], bytes: 1, now: 1_000, wroteMessage: true })
  const live = summarizeRemoteRunStreamStats(stats, 61_000, true)
  assert.equal(live.currentQuietMs, 60_000)
  assert.equal(live.maxQuietGapMs, 60_000)
  assert.equal(live.longestToolMs, 60_000)
  assert.equal(live.longestToolTitle, 'Long fetch')
  assert.equal(live.openTools, 1)
  const finished = summarizeRemoteRunStreamStats(stats, 61_000, false)
  assert.equal(finished.currentQuietMs, 0)
  assert.equal(finished.openTools, 0)
  assert.deepEqual(summarizeRemoteRunStreamStats(undefined, 5, true).batches, 0)
})
