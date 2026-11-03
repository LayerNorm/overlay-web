import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { NoObjectGeneratedError } from 'ai'
import { internal } from './_generated/api'
import schema from './schema'

const mocks = vi.hoisted(() => ({ generate: vi.fn(), price: vi.fn() }))
vi.mock('ai', async importOriginal => ({ ...await importOriginal<typeof import('ai')>(), generateObject: mocks.generate }))
vi.mock('./lib/gatewayCatalogPricing', () => ({ calculateGatewayLanguageModelCostOrNull: mocks.price }))
const modules = import.meta.glob('./**/*.ts')
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

function invalidObject(inputTokens: number | undefined = 1000) {
  return new NoObjectGeneratedError({
    text: 'invalid object', finishReason: 'stop',
    response: { id: 'fixture-response', timestamp: new Date(), modelId: 'fixture/model' },
    usage: { inputTokens, outputTokens: 100, totalTokens: inputTokens === undefined ? undefined : inputTokens + 100,
      inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 100, reasoningTokens: 0 } },
  })
}

async function fixture(error: Error) {
  vi.stubEnv('INTERNAL_API_SECRET', 'failed-memory-fixture')
  vi.stubEnv('AI_GATEWAY_API_KEY', 'not-a-real-key')
  vi.stubEnv('OVERLAY_USAGE_MARKUP_BPS', '2500')
  mocks.generate.mockRejectedValue(error)
  mocks.price.mockImplementation(async (_ctx, _model, input, _cached, output) => input === 1000 && output === 100 ? 0.0004 : 0.001)
  const t = convexTest(schema, modules)
  const conversationId = await t.run(async ctx => {
    const now = Date.now()
    await ctx.db.insert('billingAccounts', { billingAccountId: 'ba-memory', workspaceId: 'ws-memory', scope: 'workspace',
      status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: now, updatedAt: now })
    await ctx.db.insert('billingAccountSubscriptions', { billingAccountId: 'ba-memory', provider: 'preview-fixture', planKind: 'paid',
      planVersion: 'variable_v2', planAmountCents: 800, markupBasisPoints: 2500, status: 'active', paidPeriodStart: now - 1000,
      paidPeriodEnd: now + 86400000, autoTopUpEnabled: false, autoTopUpAmountCents: 0, createdAt: now, updatedAt: now })
    await ctx.db.insert('billingAccountBalances', { billingAccountId: 'ba-memory', mode: 'budgeted', includedMicros: 8000000,
      institutionalGrantMicros: 0, allowanceUsedMicros: 0, topUpPurchasedMicros: 0, topUpBalanceMicros: 0, usedMicros: 0,
      reservedMicros: 0, version: 1, createdAt: now, updatedAt: now })
    const id = await ctx.db.insert('conversations', { userId: 'memory-user', workspaceId: 'ws-memory', title: 'Memory fixture',
      lastModified: now, createdAt: now, updatedAt: now, lastMode: 'act', askModelIds: ['fixture/model'], actModelId: 'fixture/model' })
    await ctx.db.insert('conversationMessages', { userId: 'memory-user', conversationId: id, turnId: 'memory-turn', role: 'user', mode: 'act',
      contentType: 'text', content: 'I prefer short status updates in the morning and detailed weekly planning on Fridays.', createdAt: now })
    return id
  })
  const run = () => t.action(internal.knowledge.memoryExtractorNode.extractFromTurn, {
    billingAccountId: 'ba-memory', workspaceId: 'ws-memory', userId: 'memory-user', conversationId, turnId: 'memory-turn',
  })
  const read = () => t.run(async ctx => ({
    reservations: await ctx.db.query('budgetReservations').collect(),
    balance: await ctx.db.query('billingAccountBalances').unique(),
  }))
  return { t, run, read }
}

test('failed structured output settles measured provider usage once and returns no extracted memory', async () => {
  const f = await fixture(invalidObject())
  expect(await f.run()).toMatchObject({ extracted: 0, inserted: 0, reason: 'error' })
  const first = await f.read()
  expect(first.reservations).toHaveLength(1)
  expect(first.reservations[0]).toMatchObject({ status: 'finalized', usageTokens: 1100, providerCostMicros: 400, finalizedCents: 0.05 })
  expect(first.balance).toMatchObject({ usedMicros: 500, reservedMicros: 0 })
  expect(await f.run()).toMatchObject({ reason: 'already_processed' })
  expect(await f.read()).toEqual(first)
  expect(mocks.generate).toHaveBeenCalledOnce()
})

test('ambiguous provider failure retains its hold and does not fabricate zero usage', async () => {
  const f = await fixture(new Error('provider transport outcome unknown'))
  await f.run()
  const state = await f.read()
  expect(state.reservations[0]).toMatchObject({ status: 'reconcile_required', providerWorkStarted: true })
  expect(state.reservations[0]?.providerCostMicros).toBeUndefined()
  expect(state.balance?.usedMicros).toBe(0)
  expect(state.balance?.reservedMicros).toBeGreaterThan(0)
})

test('structured errors without complete usage still require reconciliation', async () => {
  const error = invalidObject()
  Object.defineProperty(error, 'usage', { value: undefined })
  const f = await fixture(error)
  await f.run()
  expect((await f.read()).reservations[0]?.status).toBe('reconcile_required')
})

test('known tokens without known pricing retain reconciliation', async () => {
  const f = await fixture(invalidObject())
  mocks.price.mockResolvedValueOnce(0.001).mockResolvedValueOnce(null)
  await f.run()
  const state = await f.read()
  expect(state.reservations[0]).toMatchObject({ status: 'reconcile_required', errorMessage: 'pricing_missing:google/gemini-2.5-flash-lite' })
  expect(state.balance?.usedMicros).toBe(0)
})
