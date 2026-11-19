import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acquireSyncBudget, syncBudgetKey, syncMethodBudget } from './rate-limit'

process.env.INTERNAL_API_SECRET = 'sync-test-secret'

test('Slack history starts on the non-Marketplace budget and switches to Tier 3 when approved', () => {
  delete process.env.SLACK_SYNC_MARKETPLACE_APPROVED
  assert.deepEqual(syncMethodBudget('slack', 'conversations.history'), { capacity: 1, refillPerMinute: 1, pageSize: 15 })
  assert.deepEqual(syncMethodBudget('slack', 'conversations.replies'), { capacity: 1, refillPerMinute: 1, pageSize: 15 })
  process.env.SLACK_SYNC_MARKETPLACE_APPROVED = 'true'
  assert.deepEqual(syncMethodBudget('slack', 'conversations.history'), { capacity: 10, refillPerMinute: 50, pageSize: 1000 })
  delete process.env.SLACK_SYNC_MARKETPLACE_APPROVED
  assert.equal(syncMethodBudget('slack', 'chat.postMessage').refillPerMinute, 50)
})

test('budgets are keyed by provider, org and method', async () => {
  const calls: Array<[string, Record<string, unknown>]> = []
  const convex = { mutation: (async (path: string, args: Record<string, unknown>) => { calls.push([path, args]); return { granted: false, waitMs: 5 } }) as never }
  const result = await acquireSyncBudget({ provider: 'slack', externalOrgId: 'T1', method: 'conversations.history', priority: 'repair' }, convex)
  assert.deepEqual(result, { granted: false, waitMs: 5 })
  assert.equal(syncBudgetKey('slack', 'T1', 'conversations.history'), 'slack:T1:conversations.history')
  assert.deepEqual(calls, [['sync/rateBudgets:take', {
    serverSecret: 'sync-test-secret', key: 'slack:T1:conversations.history', capacity: 1, refillPerMinute: 1, priority: 'repair',
  }]])
})
