import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const fn = {
  summary: makeFunctionReference<'query'>('billing/browse:workspaceSummary'),
  entitlements: makeFunctionReference<'query'>('billing/browse:entitlements'),
}
const backendUrl = 'https://fixture.convex.cloud'
const DAY = 24 * 60 * 60 * 1000

afterEach(() => { vi.unstubAllEnvs() })

type Summary = {
  canManage: boolean
  canTopUp: boolean
  initialized: boolean
  executionAccess: { state: string; canExecute: boolean }
  credits: { total: number; used: number; remaining: number }
  subscription: { planKind: string; planAmountCents: number }
  autoTopUp?: { enabled: boolean }
  usage?: { lines: Array<{ key: string; cents: number }> }
}

async function fixture(options: { billing?: boolean; funded?: boolean; membersTopUp?: boolean } = {}) {
  vi.stubEnv('OVERLAY_BFF_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', backendUrl)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'test')
  const t = convexTest(schema, modules)
  const now = Date.now()
  await t.run(async ctx => {
    await ctx.db.insert('nativeDeploymentPolicies', {
      key: 'web', sequence: 1, challenge: 'c', sourceOrigin: 'https://app.example.test', expiresAt: now + 600_000,
      snapshot: {
        version: 1, backendUrl, revision: 'a'.repeat(64), features: { billing: options.billing ?? true },
        rollout: { stage: 'general', internalWorkspaceIds: '', invitedWorkspaceIds: '' },
      },
    } as never)
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const [userId, role] of [['olivia', 'owner'], ['mark', 'member']] as const) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role, status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    if (options.membersTopUp) {
      await ctx.db.insert('workspaceSharingPolicies', { workspaceId: 'ws', publicLinksEnabled: true, usageTopUpBy: 'members', createdAt: 1, updatedAt: 1 } as never)
    }
    if (options.funded === false) return
    await ctx.db.insert('billingAccounts', {
      billingAccountId: 'acct', scope: 'workspace', workspaceId: 'ws', status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: 1, updatedAt: 1,
    } as never)
    // $8 included, $2 top-up, $3 used, $1 held: $6 remaining.
    await ctx.db.insert('billingAccountBalances', {
      billingAccountId: 'acct', mode: 'budgeted', includedMicros: 8_000_000, institutionalGrantMicros: 0, allowanceUsedMicros: 3_000_000,
      topUpPurchasedMicros: 2_000_000, topUpBalanceMicros: 2_000_000, usedMicros: 3_000_000, reservedMicros: 1_000_000, version: 1, createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('billingAccountSubscriptions', {
      billingAccountId: 'acct', provider: 'stripe', providerCustomerId: 'cus_SECRET', providerSubscriptionId: 'sub_SECRET',
      planKind: 'paid', planVersion: 'variable_v2', planAmountCents: 800, markupBasisPoints: 2500, status: 'active',
      autoTopUpEnabled: false, autoTopUpAmountCents: 800, currentPeriodStart: now - DAY, currentPeriodEnd: now + 29 * DAY,
      paidPeriodStart: now - DAY, paidPeriodEnd: now + 29 * DAY, createdAt: 1, updatedAt: 1,
    } as never)
  })
  const as = (subject: string) => t.withIdentity({ subject })
  return { t, as }
}

test('members read the workspace billing summary; only owners and admins manage it; provider IDs never leave', async () => {
  const { as } = await fixture()
  const owner = await as('olivia').query(fn.summary, { workspaceId: 'ws' }) as Summary
  expect(owner).toMatchObject({
    canManage: true, canTopUp: true, initialized: true,
    executionAccess: { state: 'ready', canExecute: true },
    subscription: { planKind: 'paid', planAmountCents: 800 },
    autoTopUp: { enabled: false },
  })
  expect(owner.credits.remaining).toBeGreaterThan(0)
  const member = await as('mark').query(fn.summary, { workspaceId: 'ws' }) as Summary
  expect(member).toMatchObject({ canManage: false, canTopUp: false })
  expect(JSON.stringify(owner)).not.toMatch(/SECRET|cus_|sub_/)
  expect(await as('stranger').query(fn.summary, { workspaceId: 'ws' })).toBeNull()
})

test('members may top up when the workspace allows it', async () => {
  const { as } = await fixture({ membersTopUp: true })
  expect(await as('mark').query(fn.summary, { workspaceId: 'ws' })).toMatchObject({ canManage: false, canTopUp: true })
})

test('entitlements show the live balance and follow charges; an unfunded workspace has nothing to spend', async () => {
  const { t, as } = await fixture()
  const before = await as('mark').query(fn.entitlements, { workspaceId: 'ws' }) as Record<string, unknown>
  expect(before).toMatchObject({ planKind: 'paid', budgetTotalCents: 1000, budgetUsedCents: 300, budgetRemainingCents: 600 })
  expect(JSON.stringify(before)).not.toMatch(/SECRET/)
  await t.run(async ctx => {
    const balance = await ctx.db.query('billingAccountBalances').withIndex('by_billingAccountId', q => q.eq('billingAccountId', 'acct')).unique()
    await ctx.db.patch(balance!._id, { usedMicros: 9_000_000, reservedMicros: 0 })
  })
  expect(await as('mark').query(fn.entitlements, { workspaceId: 'ws' })).toMatchObject({ budgetRemainingCents: 100 })

  const unfunded = await fixture({ funded: false })
  expect(await unfunded.as('olivia').query(fn.entitlements, { workspaceId: 'ws' })).toMatchObject({ planKind: 'free', budgetRemainingCents: 0 })
  expect(await unfunded.as('olivia').query(fn.summary, { workspaceId: 'ws' })).toMatchObject({
    initialized: false, executionAccess: { state: 'subscription_required', canExecute: false },
  })
})

test('with billing off the entitlements query yields to the booted entitlements and nothing is gated', async () => {
  const { as } = await fixture({ billing: false })
  expect(await as('mark').query(fn.entitlements, { workspaceId: 'ws' })).toBeNull()
  expect(await as('mark').query(fn.summary, { workspaceId: 'ws' })).toMatchObject({ executionAccess: { state: 'ready', canExecute: true } })
  expect(await as('stranger').query(fn.entitlements, { workspaceId: 'ws' })).toBeNull()
})
