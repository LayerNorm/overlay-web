import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const list = makeFunctionReference<'query'>('automations/browse:list')
const get = makeFunctionReference<'query'>('automations/browse:get')
const runs = makeFunctionReference<'query'>('automations/browse:runs')
const backendUrl = 'https://fixture.convex.cloud'

afterEach(() => { vi.unstubAllEnvs() })

async function fixture(options: { feature?: boolean } = {}) {
  vi.stubEnv('OVERLAY_BFF_URL', 'https://app.example.test')
  vi.stubEnv('CONVEX_CLOUD_URL', backendUrl)
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'test')
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('nativeDeploymentPolicies', {
      key: 'web', sequence: 1, challenge: 'c', sourceOrigin: 'https://app.example.test', expiresAt: Date.now() + 600_000,
      snapshot: { version: 1, backendUrl, revision: 'a'.repeat(64), features: { automations: options.feature ?? true }, rollout: { stage: 'off', internalWorkspaceIds: '', invitedWorkspaceIds: '' } },
    } as never)
    await ctx.db.insert('authorizationRoles', { roleId: 'auto', name: 'Auto', capabilities: ['automations.use'], isSystem: false, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const userId of ['alice', 'bob', 'carol']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
      if (userId !== 'carol') await ctx.db.insert('authorizationUserRoles', { roleId: 'auto', userId, createdAt: 1 })
    }
    const automation = (fields: Record<string, unknown>) => ctx.db.insert('automations', {
      workspaceId: 'ws', userId: 'alice', name: 'x', instructions: 'do', enabled: true, createdAt: 1, updatedAt: 1, ...fields,
    } as never)
    const mine = await automation({ name: 'Daily digest', updatedAt: 3 })
    const shared = await automation({ name: 'Team report', scope: 'workspace', updatedAt: 2 })
    await automation({ name: 'Agent job', agentId: 'agent-1', updatedAt: 4 })
    await automation({ name: 'Gone', deletedAt: 5 })
    for (const [status, at] of [['completed', 10], ['running', 20]] as const) {
      await ctx.db.insert('automationRuns', { automationId: mine, userId: 'alice', status, scheduledFor: at, createdAt: at } as never)
    }
    return { mine, shared }
  })
  const as = (subject: string) => t.withIdentity({ subject })
  return { t, as, ids }
}

const names = (rows: unknown) => (rows as Array<{ name: string }>).map(row => row.name)

test('automations list live for members with access, newest first, agent-owned ones on request', async () => {
  const { as, ids } = await fixture()
  expect(names(await as('alice').query(list, { workspaceId: 'ws' }))).toEqual(['Daily digest', 'Team report'])
  expect(names(await as('alice').query(list, { workspaceId: 'ws', includeAgentBound: true }))).toEqual(['Agent job', 'Daily digest', 'Team report'])
  expect(names(await as('bob').query(list, { workspaceId: 'ws' }))).toEqual(['Team report'])
  expect(await as('bob').query(get, { workspaceId: 'ws', automationId: ids.mine })).toBeNull()
  expect(await as('bob').query(get, { workspaceId: 'ws', automationId: ids.shared })).toMatchObject({ name: 'Team report' })
})

test('run history is newest first and only for the owner', async () => {
  const { as, ids } = await fixture()
  expect((await as('alice').query(runs, { workspaceId: 'ws', automationId: ids.mine }) as Array<{ status: string }>).map(run => run.status)).toEqual(['running', 'completed'])
  expect(await as('bob').query(runs, { workspaceId: 'ws', automationId: ids.mine })).toEqual([])
})

test('reads need automations.use, an active membership and the deployment feature', async () => {
  const { t, as, ids } = await fixture()
  expect(await as('carol').query(list, { workspaceId: 'ws' })).toBeNull()
  expect(await as('stranger').query(list, { workspaceId: 'ws' })).toBeNull()
  expect(await t.query(list, { workspaceId: 'ws' })).toBeNull()
  expect(await as('carol').query(runs, { workspaceId: 'ws', automationId: ids.mine })).toEqual([])
  const off = await fixture({ feature: false })
  expect(await off.as('alice').query(list, { workspaceId: 'ws' })).toBeNull()
})

test('a save from an older version of the form is refused instead of overwriting a newer one', async () => {
  vi.stubEnv('INTERNAL_API_SECRET', 'qa-secret')
  const { t, ids } = await fixture()
  const update = makeFunctionReference<'mutation'>('automations/automations:update')
  const base = { serverSecret: 'qa-secret', userId: 'alice', workspaceId: 'ws', automationId: ids.mine }
  await t.run(ctx => ctx.db.patch(ids.mine, { enabled: false }))
  const before = await t.run(ctx => ctx.db.get(ids.mine)) as { updatedAt: number }
  await t.mutation(update, { ...base, name: 'Renamed elsewhere', expectedUpdatedAt: before.updatedAt })
  await expect(t.mutation(update, { ...base, description: 'Stale form', expectedUpdatedAt: before.updatedAt })).rejects.toThrow('AUTOMATION_CONFLICT')
  expect(await t.run(ctx => ctx.db.get(ids.mine))).toMatchObject({ name: 'Renamed elsewhere' })
})
