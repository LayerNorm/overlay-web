import { describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
const modules = import.meta.glob('./**/*.ts')

const consume = makeFunctionReference<'mutation'>('platform/privateThreadAllowances:consumeByServer')
const read = makeFunctionReference<'query'>('platform/privateThreadAllowances:getByServer')

describe('private thread allowances', () => {
  test('count per person and month, and refuse a use that would pass the limit without counting it', async () => {
    process.env.INTERNAL_API_SECRET = 'web-test-only'
    const t = convexTest(schema, modules)
    const base = { serverSecret: 'web-test-only', userId: 'user-1', period: '2026-11', resource: 'web_search' as const, limit: 50 }
    expect(await t.mutation(consume, { ...base, amount: 48 })).toEqual({ ok: true, used: 48, limit: 50 })
    expect(await t.mutation(consume, { ...base, amount: 3 })).toEqual({ ok: false, used: 48, limit: 50 })
    expect(await t.mutation(consume, { ...base, amount: 2 })).toEqual({ ok: true, used: 50, limit: 50 })
    expect(await t.mutation(consume, { ...base, amount: 1 })).toEqual({ ok: false, used: 50, limit: 50 })
    expect(await t.mutation(consume, { ...base, period: '2026-12', amount: 1 })).toEqual({ ok: true, used: 1, limit: 50 })
    expect(await t.mutation(consume, { ...base, userId: 'user-2', amount: 1 })).toEqual({ ok: true, used: 1, limit: 50 })
    expect(await t.query(read, { serverSecret: 'web-test-only', userId: 'user-1', period: '2026-11' })).toEqual({ webSearches: 50 })
  })

  test('only the server can count', async () => {
    process.env.INTERNAL_API_SECRET = 'web-test-only'
    const t = convexTest(schema, modules)
    await expect(t.mutation(consume, {
      serverSecret: 'wrong', userId: 'user-1', period: '2026-11', resource: 'web_search', amount: 1, limit: 50,
    })).rejects.toThrow()
  })
})
