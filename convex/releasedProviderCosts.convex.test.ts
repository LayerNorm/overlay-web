import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const record = makeFunctionReference<'mutation'>('billing/releasedProviderCosts:recordInternal')
const report = makeFunctionReference<'query'>('platform/usage:getBillingAccountOperationalReportByServer')
const args = {
  expectedDeploymentUrl: 'https://preview-fixture.convex.cloud', billingAccountId: 'ba-fixture',
  reservationId: 'failed-generation', modelId: 'provider/model', providerCostMicros: 82, usageTokens: 467,
  evidence: { source: 'provider:generation', reference: 'generation-fixture', reason: 'Schema rejected output; provider incurred cost.' },
}
afterEach(() => vi.unstubAllEnvs())

async function fixture() {
  vi.stubEnv('CONVEX_CLOUD_URL', args.expectedDeploymentUrl)
  vi.stubEnv('INTERNAL_API_SECRET', 'test-secret')
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('budgetReservations', {
      userId: 'user-fixture', billingAccountId: args.billingAccountId, reservationId: args.reservationId,
      modelId: args.modelId, status: 'released', kind: 'generation', reservedCents: 0.06,
      providerWorkStarted: true, providerWorkCompleted: false,
      reconciliationEvidenceSource: 'system:stale-hold-policy', reconciliationResolution: 'released',
      reconciliationResolvedAt: 2, createdAt: 1, updatedAt: 2,
    })
    await ctx.db.insert('billingAccountBalances', {
      billingAccountId: args.billingAccountId, mode: 'budgeted', includedMicros: 8_000_000,
      institutionalGrantMicros: 0, topUpPurchasedMicros: 0, topUpBalanceMicros: 0,
      allowanceUsedMicros: 120, usedMicros: 120, reservedMicros: 0, version: 1, createdAt: 1, updatedAt: 2,
    })
  })
  return t
}

test('late failed-call expense is recorded once, preserves release and wallet, and appears in provider cost', async () => {
  const t = await fixture()
  const balance = () => t.run(ctx => ctx.db.query('billingAccountBalances').first())
  const before = await balance()
  expect(await t.mutation(record, args)).toEqual({ idempotent: false, providerCostMicros: 82 })
  const saved = await t.run(ctx => ctx.db.query('budgetReservations').first())
  expect(saved).toMatchObject({ status: 'released', providerCostMicros: 82, usageTokens: 467,
    reconciliationEvidenceSource: 'system:stale-hold-policy', reconciliationResolvedAt: 2, updatedAt: 2,
    providerCostEvidence: args.evidence })
  expect(await t.mutation(record, args)).toEqual({ idempotent: true, providerCostMicros: 82 })
  expect(await balance()).toEqual(before)
  expect(await t.query(report, { billingAccountId: args.billingAccountId, serverSecret: 'test-secret',
    periodStart: 0, now: 10, reconciliationSlaMs: 100 })).toMatchObject({ actualProviderCostCents: 0.0082, retailCostCents: 0 })
  await expect(t.mutation(record, { ...args, providerCostMicros: 83 })).rejects.toThrow('provider_evidence_conflict')
  expect(await balance()).toEqual(before)
})

test('wrong target, account, model, empty evidence, invalid cost and non-released work cannot be annotated', async () => {
  const t = await fixture()
  for (const patch of [{ expectedDeploymentUrl: 'https://other.convex.cloud' }, { billingAccountId: 'other' },
    { modelId: 'other' }, { providerCostMicros: -1 }, { providerCostMicros: 1.5 },
    { evidence: { ...args.evidence, reference: ' ' } }]) {
    await expect(t.mutation(record, { ...args, ...patch })).rejects.toThrow()
  }
  await t.run(async ctx => {
    const row = (await ctx.db.query('budgetReservations').first())!
    await ctx.db.patch(row._id, { status: 'reserved' })
  })
  await expect(t.mutation(record, args)).rejects.toThrow('reservation_not_released_provider_work')
  expect((await t.run(ctx => ctx.db.query('budgetReservations').first()))?.providerCostMicros).toBeUndefined()
})
