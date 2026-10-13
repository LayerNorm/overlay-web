import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'work-synthetic-secret'
const auth = { serverSecret: secret, workspaceId: 'ws-work' }
const q = (path: string) => makeFunctionReference<'query'>(`work/${path}`)
const m = (path: string) => makeFunctionReference<'mutation'>(`work/${path}`)
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })
async function fixture(policy?: 'admins') {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    for (const [userId, role] of [['alice', 'member'], ['bob', 'member'], ['owner', 'owner'], ['guest', 'guest']] as const) {
      await ctx.db.insert('workspacePrincipals', { principalId: `p-${userId}`, workspaceId: auth.workspaceId, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { membershipId: `m-${userId}`, workspaceId: auth.workspaceId, principalId: `p-${userId}`, status: 'active', role, joinedAt: 1, updatedAt: 1 })
    }
    if (policy) await ctx.db.insert('workspaceSharingPolicies', { workspaceId: auth.workspaceId, workspaceContentEditors: policy, memberCanMoveScope: false, publicLinksEnabled: false, createdAt: 1, updatedAt: 1 })
  })
  return t
}
type Task = { _id: string; title: string; updatedAt: number; scope: string }
const create = (t: Awaited<ReturnType<typeof fixture>>, fields: Record<string, unknown> = {}) => t.mutation(m('workItems:create'), { ...auth, userId: 'alice', title: 'Task', ...fields }) as Promise<Task>
const list = (t: Awaited<ReturnType<typeof fixture>>, userId: string, view = 'personal') => t.query(q('workItems:list'), { ...auth, userId, view }) as Promise<Task[]>

describe('Work scope and identity boundaries', () => {
  test('private tasks and their activity remain creator-only; shared tasks are readable across members', async () => {
    const t = await fixture()
    const personal = await create(t)
    await create(t, { scope: 'workspace', title: 'Shared' })
    expect((await list(t, 'alice')).map((r) => r.title)).toEqual(['Task'])
    expect(await list(t, 'bob')).toEqual([])
    expect(await list(t, 'owner')).toEqual([])
    expect((await list(t, 'bob', 'workspace')).map((r) => r.title)).toEqual(['Shared'])
    await expect(t.query(q('workItems:get'), { ...auth, userId: 'bob', id: personal._id })).rejects.toThrow(/Task not found/)
    await expect(t.query(q('workItemEvents:list'), { ...auth, userId: 'bob', id: personal._id })).rejects.toThrow(/Task not found/)
    await expect(list(t, 'guest')).rejects.toThrow(/membership/)
    await expect(list(t, 'outsider')).rejects.toThrow(/membership/)
    await expect(t.query(q('workItems:list'), { ...auth, serverSecret: 'bad', userId: 'alice' })).rejects.toThrow()
  })
  test('policy limits workspace creation and moving; rejects stale edits and invalid assignees', async () => {
    const t = await fixture('admins')
    await expect(create(t, { scope: 'workspace' })).rejects.toThrow(/restricted/)
    const task = await create(t)
    await expect(t.mutation(m('workItems:lifecycle'), { ...auth, userId: 'alice', id: task._id, action: 'scope', to: 'workspace' })).rejects.toThrow(/move_disabled/)
    await expect(create(t, { assigneePrincipalId: 'p-bob' })).rejects.toThrow(/can see/)
    await expect(create(t, { startDate: '2026-02-30' })).rejects.toThrow(/date/)
    const edited = await t.mutation(m('workItems:update'), { ...auth, userId: 'alice', id: task._id, expectedUpdatedAt: task.updatedAt, patch: { status: 'progress' } }) as Task
    expect(edited.updatedAt).toBeGreaterThan(task.updatedAt)
    await expect(t.mutation(m('workItems:update'), { ...auth, userId: 'alice', id: task._id, expectedUpdatedAt: task.updatedAt, patch: { title: 'Stale' } })).rejects.toThrow(/changed/)
  })
  test('move, archive, restore and comments persist activity and enforce edit ownership', async () => {
    const t = await fixture()
    const task = await create(t)
    const lifecycle = (userId: string, action: string, to?: string) => t.mutation(m('workItems:lifecycle'), { ...auth, userId, id: task._id, action, ...(to ? { to } : {}) })
    await lifecycle('alice', 'scope', 'workspace')
    expect(await list(t, 'bob', 'workspace')).toHaveLength(1)
    await expect(lifecycle('bob', 'archived')).rejects.toThrow(/forbidden/)
    await t.mutation(m('workItemEvents:comment'), { ...auth, userId: 'bob', id: task._id, text: 'Ready for review' })
    await lifecycle('owner', 'archived')
    expect(await list(t, 'bob', 'workspace')).toHaveLength(0)
    expect(await list(t, 'bob', 'archived')).toHaveLength(1)
    await lifecycle('alice', 'restored')
    expect(await list(t, 'bob', 'workspace')).toHaveLength(1)
    const events = await t.query(q('workItemEvents:list'), { ...auth, userId: 'alice', id: task._id }) as { kind: string }[]
    expect(events.map((e) => e.kind).sort()).toEqual(['archived', 'comment', 'created', 'restored', 'scope'])
  })
  test('one-level hierarchy rejects self, descendant, private and cross-workspace parents', async () => {
    const t = await fixture()
    const parent = await create(t)
    const child = await create(t, { parentId: parent._id })
    await expect(create(t, { parentId: child._id })).rejects.toThrow(/top-level/)
    await expect(t.mutation(m('workItems:update'), { ...auth, userId: 'alice', id: parent._id, expectedUpdatedAt: parent.updatedAt, patch: { parentId: parent._id } })).rejects.toThrow(/own parent/)
    await expect(t.mutation(m('workItems:update'), { ...auth, userId: 'alice', id: parent._id, expectedUpdatedAt: parent.updatedAt, patch: { parentId: child._id } })).rejects.toThrow(/top-level/)
    await expect(create(t, { userId: 'bob', parentId: parent._id })).rejects.toThrow(/not found/)
    await expect(create(t, { scope: 'workspace', parentId: parent._id })).rejects.toThrow(/same scope/)
  })
})
