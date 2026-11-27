import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { chargeSpendLimits, spendLimitsReached, spendSubjectsFor } from './lib/spendLimitCharges'
import { insertUsageOperation } from './billing/usageTotals'

const modules = import.meta.glob('./**/*.ts')
const secret = 'member-spend-secret'
const workspaceId = 'ws-spend'
const m = (name: string) => makeFunctionReference<'mutation'>(name)
const MICROS = 10_000

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function seed() {
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', { workspaceId, kind: 'organization', name: 'Spend', slug: 'spend', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const [userId, role] of [['owner', 'owner'], ['alice', 'member'], ['bob', 'member']] as const) {
      await ctx.db.insert('workspacePrincipals', { principalId: `p-${userId}`, workspaceId, type: 'human', userId, displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { membershipId: `m-${userId}`, workspaceId, principalId: `p-${userId}`, role, status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    await ctx.db.insert('billingAccounts', { billingAccountId: 'ba-ws', scope: 'workspace', workspaceId, status: 'active',
      pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: 1, updatedAt: 1 })
    const now = Date.now()
    await ctx.db.insert('billingAccountSubscriptions', { billingAccountId: 'ba-ws', provider: 'stripe', planKind: 'paid',
      planVersion: 'variable_v2', planAmountCents: 2_000, markupBasisPoints: 2500, status: 'active', autoTopUpEnabled: false,
      autoTopUpAmountCents: 0, currentPeriodStart: now - 10 * 86_400_000, currentPeriodEnd: now + 20 * 86_400_000, createdAt: 1, updatedAt: 1 })
    // Alice already spent 3¢ this period; Bob 1¢.
    for (const [userId, cents] of [['alice', 2], ['alice', 1], ['bob', 1]] as const) {
      await insertUsageOperation(ctx, { userId, billingAccountId: 'ba-ws', operationId: `op-${userId}-${cents}`, recorded: 1, cents, kind: 'agent', createdAt: Date.now() - 1_000 })
    }
  })
  return convex
}

const setCap = (convex: ReturnType<typeof convexTest>, actorUserId: string, userId: string, capCents: number | null) =>
  convex.mutation(m('billing/memberSpend:setMemberCapByServer'), { serverSecret: secret, workspaceId, actorUserId, userId, capCents })

describe('per-person spending caps', () => {
  test('only owners and admins set them; a new cap counts what the person already spent', async () => {
    const convex = await seed()
    await expect(setCap(convex, 'alice', 'bob', 500)).rejects.toThrow('WORKSPACE_BILLING_MANAGE_FORBIDDEN')
    await expect(setCap(convex, 'owner', 'stranger', 500)).rejects.toThrow('WORKSPACE_MEMBER_NOT_FOUND')
    expect(await setCap(convex, 'owner', 'alice', 5)).toEqual({ capCents: 5 })
    const row = await convex.run(async (ctx) => await ctx.db.query('billingAccountSpendLimits').first())
    expect(row).toMatchObject({ subjectKind: 'member', subjectId: 'alice', limitMicros: 5 * MICROS, usedMicros: 3 * MICROS })
    expect(await setCap(convex, 'owner', 'alice', null)).toEqual({ capCents: null })
    expect(await convex.run(async (ctx) => await ctx.db.query('billingAccountSpendLimits').collect())).toEqual([])
  })

  test('a person’s cap counts everything they start, their automations included, and stops them when used up', async () => {
    const convex = await seed()
    await setCap(convex, 'owner', 'alice', 5)
    const result = await convex.run(async (ctx) => {
      const now = Date.now()
      const automation = { kind: 'programmatic' as const, id: 'automation:a1' }
      const subjects = spendSubjectsFor('alice', automation)
      const before = await spendLimitsReached(ctx, { billingAccountId: 'ba-ws', subjects, now })
      const charged = await chargeSpendLimits(ctx, { billingAccountId: 'ba-ws', subjects, micros: 2 * MICROS, now })
      const bobStillFree = await spendLimitsReached(ctx, { billingAccountId: 'ba-ws', subjects: spendSubjectsFor('bob'), now })
      return { before, charged, after: await spendLimitsReached(ctx, { billingAccountId: 'ba-ws', subjects, now }), bobStillFree }
    })
    expect(result).toEqual({ before: false, charged: { limitReached: true }, after: true, bobStillFree: false })
  })

  test('a cap renews each period: a charge after it ends starts the count again', async () => {
    const convex = await seed()
    const used = await convex.run(async (ctx) => {
      await ctx.db.insert('billingAccountSpendLimits', { billingAccountId: 'ba-ws', subjectKind: 'member', subjectId: 'alice',
        limitMicros: 5 * MICROS, usedMicros: 5 * MICROS, reservedMicros: 0, periodStart: 0, periodEnd: 100, version: 0, createdAt: 1, updatedAt: 1 })
      const subjects = spendSubjectsFor('alice')
      const reachedLater = await spendLimitsReached(ctx, { billingAccountId: 'ba-ws', subjects, now: 250 })
      await chargeSpendLimits(ctx, { billingAccountId: 'ba-ws', subjects, micros: 1 * MICROS, now: 250 })
      const row = await ctx.db.query('billingAccountSpendLimits').first()
      return { reachedLater, row: { usedMicros: row?.usedMicros, periodStart: row?.periodStart, periodEnd: row?.periodEnd } }
    })
    expect(used).toEqual({ reachedLater: false, row: { usedMicros: 1 * MICROS, periodStart: 200, periodEnd: 300 } })
  })
})
