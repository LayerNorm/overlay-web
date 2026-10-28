import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const seed = makeFunctionReference<'mutation'>('dev/seed:initQa')
afterEach(() => vi.unstubAllEnvs())

test.each(['production', 'staging', 'development'])('QA seed refuses %s', async (environment) => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', environment)
  const t = convexTest(schema, modules)
  await expect(t.mutation(seed, {})).rejects.toThrow('Preview seed is unavailable')
  expect(await t.run(ctx => ctx.db.query('workspaces').collect())).toHaveLength(0)
})

test('QA seed is opt-in, idempotent and preserves spent allowance', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_qa_seed')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'qa@example.test')
  const t = convexTest(schema, modules)
  await t.mutation(makeFunctionReference<'mutation'>('dev/seed:init'), {})
  expect(await t.run(ctx => ctx.db.query('billingAccountSubscriptions').collect())).toHaveLength(0)
  const result = await t.mutation(seed, {})
  await t.run(async ctx => {
    const balance = (await ctx.db.query('billingAccountBalances').collect())[0]
    await ctx.db.patch(balance._id, { usedMicros: 100_000, allowanceUsedMicros: 100_000 })
  })
  expect(await t.mutation(seed, {})).toEqual(result)
  await t.run(async ctx => {
    expect(await ctx.db.query('workspaces').collect()).toHaveLength(2)
    const people = (await ctx.db.query('workspacePrincipals').collect())
      .filter(p => p.workspaceId === result.workspaceId && p.type === 'human')
    expect(people).toHaveLength(2)
    expect(people.filter(p => p.userId === result.userId)).toHaveLength(1)
    const agents = await ctx.db.query('workspaceAgentDefinitions').collect()
    expect(agents).toHaveLength(2)
    expect(new Set(agents.map(a => a.createdByPrincipalId)).size).toBe(2)
    expect(agents.map(a => a.visibility).sort()).toEqual(['creator', 'workspace'])
    const plans = await ctx.db.query('billingAccountSubscriptions').collect()
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ planKind: 'paid', provider: 'preview-fixture', autoTopUpEnabled: false })
    expect(plans[0].providerSubscriptionId).toBeUndefined()
    const balances = await ctx.db.query('billingAccountBalances').collect()
    expect(balances).toHaveLength(1)
    expect(balances[0]).toMatchObject({ includedMicros: 1_000_000, usedMicros: 100_000, allowanceUsedMicros: 100_000 })
    expect(await ctx.db.query('workspaceInvitations').collect()).toHaveLength(0)
  })
})

test('real QA member joins the team while outsider has only its own personal workspace', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_owner')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'owner@example.test')
  vi.stubEnv('PREVIEW_MEMBER_LOGIN_USER_ID', 'user_member')
  vi.stubEnv('PREVIEW_MEMBER_LOGIN_EMAIL', 'member@example.test')
  vi.stubEnv('PREVIEW_OUTSIDER_LOGIN_USER_ID', 'user_outsider')
  vi.stubEnv('PREVIEW_OUTSIDER_LOGIN_EMAIL', 'outsider@example.test')
  const t = convexTest(schema, modules)
  await t.mutation(makeFunctionReference<'mutation'>('dev/seed:init'), {})
  const team = await t.mutation(seed, {})
  await t.mutation(seed, {})
  await t.run(async ctx => {
    const people = await ctx.db.query('workspacePrincipals').collect()
    expect(people.filter(p => p.workspaceId === team.workspaceId && p.userId === 'user_member')).toHaveLength(1)
    expect(people.filter(p => p.workspaceId === team.workspaceId && p.userId === 'user_outsider')).toHaveLength(0)
    const outsider = await ctx.db.query('workspaces')
      .withIndex('by_personalOwnerUserId', q => q.eq('personalOwnerUserId', 'user_outsider')).unique()
    expect(outsider).not.toBeNull()
    const memberships = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', team.workspaceId)
        .eq('principalId', `${team.workspaceId}-qa-member`)).collect()
    expect(memberships).toHaveLength(1)
    expect(memberships[0].role).toBe('member')
  })
  vi.stubEnv('PREVIEW_OUTSIDER_LOGIN_USER_ID', 'user_member')
  await expect(t.mutation(makeFunctionReference<'mutation'>('dev/seed:init'), {})).rejects.toThrow('distinct')
})
