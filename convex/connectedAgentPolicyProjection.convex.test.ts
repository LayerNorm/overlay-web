import {beforeAll, expect, test} from 'vitest'
import {convexTest} from 'convex-test'
import {makeFunctionReference} from 'convex/server'
import schema from './schema'
import {connectedAgentPolicyProjection} from './lib/connectedAgentPolicyProjection'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-policy-projection-test-secret'
beforeAll(() => {process.env.INTERNAL_API_SECRET = secret})

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const workspace = await ctx.db.insert('workspaces', {workspaceId: 'ws', kind: 'organization', name: 'Policy', slug: 'policy', status: 'active', createdAt: 1, updatedAt: 1})
    const principal = await ctx.db.insert('workspacePrincipals', {workspaceId: 'ws', principalId: 'human', type: 'human', userId: 'user', displayName: 'Policy owner', createdAt: 1, updatedAt: 1})
    const membership = await ctx.db.insert('workspaceMemberships', {workspaceId: 'ws', principalId: 'human', membershipId: 'member', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1})
    const account = await ctx.db.insert('billingAccounts', {billingAccountId: 'workspace-wallet', scope: 'workspace', workspaceId: 'ws', status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: 1, updatedAt: 1})
    const subscription = await ctx.db.insert('billingAccountSubscriptions', {billingAccountId: 'workspace-wallet', provider: 'stripe', planKind: 'paid', planVersion: 'variable_v2', planAmountCents: 2000, markupBasisPoints: 2500, status: 'active', autoTopUpEnabled: false, autoTopUpAmountCents: 0, createdAt: 1, updatedAt: 1})
    const balance = await ctx.db.insert('billingAccountBalances', {billingAccountId: 'workspace-wallet', mode: 'budgeted', includedMicros: 100, institutionalGrantMicros: 0, allowanceUsedMicros: 0, topUpPurchasedMicros: 0, topUpBalanceMicros: 0, usedMicros: 0, reservedMicros: 0, version: 1, createdAt: 1, updatedAt: 1})
    await ctx.db.insert('agentRemoteSessions', {sessionId: 'session', workspaceId: 'ws', environmentId: 'env', bindingId: 'binding', runId: 'run', status: 'running', commandCursor: 0, eventCursor: 0, capabilitySnapshot: {billing: {userId: 'user'}}, createdAt: 1, updatedAt: 1})
    return {workspace, principal, membership, account, subscription, balance}
  })
  const project = () => t.run(async ctx => {
    const value = await connectedAgentPolicyProjection(ctx, {workspaceId: 'ws', userId: 'user'})
    return value === undefined ? 'legacy' : value
  })
  const session = () => t.query(makeFunctionReference<'query'>('agents/connectedAgents:getRemoteSessionForRunByServer'), {serverSecret: secret, workspaceId: 'ws', environmentId: 'env', runId: 'run'})
  return {t, ids, project, session}
}

test('session policy uses the same current paid plan as billing entitlements and preserves the session on refusal', async () => {
  const {t, ids, project, session} = await fixture()
  for (const status of ['active', 'trialing', 'past_due', 'canceled'] as const) {
    await t.run(ctx => ctx.db.patch(ids.subscription, {status}))
    const billing = await t.query(makeFunctionReference<'query'>('billing/accountSubscriptions:getEntitlementsByServer'), {serverSecret: secret, billingAccountId: 'workspace-wallet'})
    expect(await project()).toEqual({planKind: billing.planKind, tier: billing.tier})
  }
  expect((await session()).policyEntitlements).toEqual({planKind: 'paid', tier: 'pro'})
  await t.run(ctx => ctx.db.patch(ids.account, {status: 'suspended'}))
  expect(await project()).toBeNull()
  expect(await session()).toMatchObject({id: 'session', policyEntitlements: null})
})

test('revoked membership, archived principals and workspaces cannot retain a paid policy', async () => {
  const {t, ids, project} = await fixture()
  await t.run(ctx => ctx.db.patch(ids.membership, {status: 'suspended'}))
  expect(await project()).toBeNull()
  await t.run(async ctx => {await ctx.db.patch(ids.membership, {status: 'active'}); await ctx.db.patch(ids.principal, {archivedAt: 2})})
  expect(await project()).toBeNull()
  await t.run(async ctx => {await ctx.db.patch(ids.principal, {archivedAt: undefined}); await ctx.db.patch(ids.workspace, {status: 'archived'})})
  expect(await project()).toBeNull()
  expect(await t.run(ctx => connectedAgentPolicyProjection(ctx, {workspaceId: 'ws', userId: 'foreign-user'}))).toBeNull()
})

test('missing paid balances and duplicate wallet ownership fail closed', async () => {
  const {t, ids, project} = await fixture()
  await t.run(ctx => ctx.db.delete(ids.balance))
  expect(await project()).toBeNull()
  await t.run(async ctx => {
    const account = await ctx.db.get(ids.account)
    if (!account) throw Error('Fixture missing')
    const {_id, _creationTime, ...values} = account
    await ctx.db.insert('billingAccounts', {...values, billingAccountId: 'duplicate'})
  })
  expect(await project()).toBeNull()
})

test('downgrade is read immediately; legacy initialization remains available only for missing personal wallets or balances', async () => {
  const {t, ids, project, session} = await fixture()
  await t.run(ctx => ctx.db.patch(ids.subscription, {planKind: 'free'}))
  expect(await project()).toBe('legacy')
  expect(await session()).not.toHaveProperty('policyEntitlements')
  const personal = await t.run(ctx => ctx.db.insert('billingAccounts', {billingAccountId: 'personal-wallet', scope: 'personal', userId: 'user', status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: 1, updatedAt: 1}))
  expect(await project()).toBe('legacy')
  await t.run(ctx => ctx.db.insert('billingAccountBalances', {billingAccountId: 'personal-wallet', mode: 'budgeted', includedMicros: 0, institutionalGrantMicros: 0, allowanceUsedMicros: 0, topUpPurchasedMicros: 0, topUpBalanceMicros: 0, usedMicros: 0, reservedMicros: 0, version: 1, createdAt: 1, updatedAt: 1}))
  expect(await project()).toEqual({planKind: 'free', tier: 'free'})
  await t.run(ctx => ctx.db.patch(ids.account, {status: 'closed'}))
  expect(await project()).toEqual({planKind: 'free', tier: 'free'})
  await t.run(ctx => ctx.db.patch(personal, {status: 'closed'}))
  expect(await project()).toBeNull()
})
