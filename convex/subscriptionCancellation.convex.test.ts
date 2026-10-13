import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'cancellation-test-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })
const internalUpdate = makeFunctionReference<'mutation'>('billing/accountSubscriptions:upsertFromStripeInternal')
const serverUpdate = makeFunctionReference<'mutation'>('billing/accountSubscriptions:upsertByServer')

async function fixture({ used = 700, reserved = 0, grant = 0, topUps = 0 } = {}) {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('billingAccounts', { billingAccountId: 'ba-test', scope: 'workspace', workspaceId: 'ws-test',
      status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('billingAccountSubscriptions', { billingAccountId: 'ba-test', provider: 'stripe', planKind: 'paid',
      planVersion: 'variable_v2', planAmountCents: 2000, markupBasisPoints: 2500, status: 'active',
      autoTopUpEnabled: true, autoTopUpAmountCents: 800, currentPeriodStart: 1, providerEventCreatedAt: 1,
      createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('billingAccountBalances', { billingAccountId: 'ba-test', mode: 'budgeted', includedMicros: 20_000_000,
      institutionalGrantMicros: grant, allowanceUsedMicros: used, topUpPurchasedMicros: topUps, topUpBalanceMicros: topUps,
      usedMicros: used, reservedMicros: reserved, version: 1, createdAt: 1, updatedAt: 1 })
  })
  return t
}
const cancel = { billingAccountId: 'ba-test', planKind: 'free' as const, planAmountCents: 0, status: 'canceled' as const,
  providerEventCreatedAt: 2, currentPeriodStart: 1 }
const snapshot = (t: ReturnType<typeof convexTest>) => t.run(async ctx => ({
  subscription: await ctx.db.query('billingAccountSubscriptions').first(),
  balance: await ctx.db.query('billingAccountBalances').first(),
}))

describe('subscription cancellation preserves paid usage accounting', () => {
  for (const route of ['internal', 'server'] as const) {
    test(`${route} cancellation succeeds after spend and does not leave unused paid credit`, async () => {
      const t = await fixture()
      await t.mutation(route === 'internal' ? internalUpdate : serverUpdate,
        route === 'internal' ? cancel : { ...cancel, serverSecret: secret })
      const { subscription, balance } = await snapshot(t)
      expect(subscription).toMatchObject({ planKind: 'free', planAmountCents: 0, status: 'canceled', autoTopUpEnabled: false })
      expect(balance).toMatchObject({ includedMicros: 700, usedMicros: 700, reservedMicros: 0 })
    })
  }
  test('existing holds survive cancellation even if the provider reports a later period', async () => {
    const t = await fixture({ used: 700, reserved: 300 })
    await t.mutation(internalUpdate, { ...cancel, currentPeriodStart: 4_000_000 })
    expect((await snapshot(t)).balance).toMatchObject({ includedMicros: 1000, usedMicros: 700, reservedMicros: 300 })
  })
  for (const route of ['internal', 'server'] as const) {
    for (const settle of [false, true]) {
      test(`${route} cancellation removes released hold funding (settle=${settle})`, async () => {
        const t = await fixture({ used: 700, reserved: 300 })
        await t.run(async ctx => {
          await ctx.db.insert('budgetReservations', { userId: 'user-test', billingAccountId: 'ba-test',
            spendSubjectKind: 'programmatic', spendSubjectId: 'agent:test', reservationId: 'hold-test',
            status: 'reserved', kind: 'agent', reservedCents: 0.03, createdAt: 1, updatedAt: 1 })
        })
        await t.mutation(route === 'internal' ? internalUpdate : serverUpdate,
          route === 'internal' ? cancel : { ...cancel, serverSecret: secret })
        const path = settle ? 'finalizeBudgetReservationByServer' : 'releaseBudgetReservationByServer'
        await t.mutation(makeFunctionReference<'mutation'>('platform/usage:' + path), {
          serverSecret: secret, userId: 'user-test', reservationId: 'hold-test',
          ...(settle ? { actualCents: 0.01 } : {}),
        })
        const { balance } = await snapshot(t)
        expect(balance).toMatchObject({ includedMicros: settle ? 800 : 700,
          usedMicros: settle ? 800 : 700, reservedMicros: 0 })
        expect(balance!.includedMicros - balance!.usedMicros).toBe(0)
        const entitlements = await t.query(makeFunctionReference<'query'>('billing/accountSubscriptions:getEntitlementsByServer'),
          { billingAccountId: 'ba-test', serverSecret: secret })
        expect(entitlements).toMatchObject({ planKind: 'free', status: 'canceled', budgetRemainingCents: 0 })
      })
    }
  }
  test('grants and top-ups remain accounted for without retaining unused plan credit', async () => {
    const t = await fixture({ used: 1500, reserved: 500, grant: 700, topUps: 300 })
    await t.mutation(internalUpdate, cancel)
    expect((await snapshot(t)).balance).toMatchObject({ includedMicros: 1000, institutionalGrantMicros: 700,
      topUpPurchasedMicros: 300, usedMicros: 1500, reservedMicros: 500 })
  })
  test('ordinary active downgrades still refuse to remove consumed funding', async () => {
    const t = await fixture()
    await expect(t.mutation(internalUpdate, { ...cancel, status: 'active' })).rejects.toThrow('remove already consumed')
    expect((await snapshot(t)).subscription?.planKind).toBe('paid')
  })
  test('an older provider event cannot reactivate the canceled plan', async () => {
    const t = await fixture()
    await t.mutation(internalUpdate, cancel)
    expect(await t.mutation(internalUpdate, { ...cancel, providerEventCreatedAt: 1, planKind: 'paid',
      planAmountCents: 2000, status: 'active' })).toEqual({ applied: false })
    expect((await snapshot(t)).subscription?.status).toBe('canceled')
  })
})
