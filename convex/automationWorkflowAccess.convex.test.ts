import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { readableWorkflowAutomation } from './automations/workflowAccess'

const modules = import.meta.glob('./**/*.ts')
const canRead = makeFunctionReference<'query'>('automations/workflowAccess:canReadByServer')
const secret = 'workflow-access-test'
afterEach(() => vi.unstubAllEnvs())

async function fixture() {
  vi.stubEnv('INTERNAL_API_SECRET', secret)
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    for (const userId of ['owner', 'member']) {
      const principalId = `principal-${userId}`
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'workspace-a', principalId, userId,
        type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { membershipId: `membership-${userId}`, workspaceId: 'workspace-a', principalId,
        role: userId === 'owner' ? 'owner' : 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    const automationId = await ctx.db.insert('automations', { workspaceId: 'workspace-a', userId: 'owner',
      name: 'Private test', instructions: 'Test', enabled: false, scope: 'personal',
      schedulerWorkflowRunId: 'legacy-scheduler', createdAt: 1, updatedAt: 1 })
    const runId = await ctx.db.insert('automationRuns', { automationId, userId: 'owner',
      status: 'completed', workflowRunId: 'workflow-a', scheduledFor: 1, createdAt: 1 })
    return { automationId, runId }
  })
  return { t, ...ids }
}

test('workflow reads use the parent resource scope and current workspace membership', async () => {
  const { t, automationId } = await fixture()
  const args = { serverSecret: secret, workflowRunId: 'workflow-a', workspaceId: 'workspace-a' }
  expect(await t.query(canRead, { ...args, userId: 'owner' })).toBe(true)
  for (const userId of ['member', 'outsider']) {
    expect(await t.query(canRead, { ...args, userId })).toBe(false)
    expect(await t.run(ctx => readableWorkflowAutomation(ctx, { workflowRunId: 'workflow-a', userId }))).toBeNull()
  }
  expect(await t.query(canRead, { ...args, userId: 'owner', workspaceId: 'another-workspace' })).toBe(false)
  await expect(t.query(canRead, { ...args, userId: 'owner', serverSecret: 'wrong' })).rejects.toThrow()
  await t.run(ctx => ctx.db.patch(automationId, { scope: 'workspace' }))
  expect(await t.query(canRead, { ...args, userId: 'member' })).toBe(true)
  expect(await t.query(canRead, { ...args, userId: 'outsider' })).toBe(false)
  await t.run(async ctx => {
    const membership = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', 'workspace-a').eq('principalId', 'principal-member')).unique()
    if (membership) await ctx.db.patch(membership._id, { status: 'suspended' })
  })
  expect(await t.query(canRead, { ...args, userId: 'member' })).toBe(false)
})

test('legacy schedulers are bound to their parent; unknown and deleted workflows fail closed', async () => {
  const { t, automationId } = await fixture()
  const args = { serverSecret: secret, userId: 'owner', workspaceId: 'workspace-a' }
  expect(await t.query(canRead, { ...args, workflowRunId: 'legacy-scheduler' })).toBe(true)
  expect(await t.query(canRead, { ...args, workflowRunId: 'unknown' })).toBe(false)
  await t.run(ctx => ctx.db.patch(automationId, { deletedAt: 2 }))
  for (const workflowRunId of ['legacy-scheduler', 'workflow-a']) {
    expect(await t.query(canRead, { ...args, workflowRunId })).toBe(false)
  }
})
