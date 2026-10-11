import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'work-items-rules-secret'
const now = 1_900_000_000_000
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const get = makeFunctionReference<'query'>('work/items:get')
const search = makeFunctionReference<'query'>('work/items:search')
const create = makeFunctionReference<'mutation'>('work/items:create')
const update = makeFunctionReference<'mutation'>('work/items:update')
const reorder = makeFunctionReference<'mutation'>('work/items:reorder')
const setScope = makeFunctionReference<'mutation'>('work/items:setScope')

type Convex = ReturnType<typeof convexTest>
type Item = {
  _id: string
  userId: string
  title: string
  scope?: string
  status: string
  itemNumber: number
  orderKey: string
  assigneeUserId?: string
  parentItemId?: string
  startDate?: number
  dueDate?: number
}
const call = { serverSecret: secret }

async function addMember(convex: Convex, workspaceId: string, userId: string, role: 'owner' | 'admin' | 'member' | 'guest' = 'member', status: 'active' | 'suspended' = 'active') {
  await convex.run(async (ctx) => {
    const principalId = `p-${workspaceId}-${userId}`
    await ctx.db.insert('workspacePrincipals', { principalId, workspaceId, type: 'human', userId, displayName: userId, createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceMemberships', { membershipId: `m-${principalId}`, workspaceId, principalId, role, status, joinedAt: now, updatedAt: now })
  })
  return `p-${workspaceId}-${userId}`
}

async function addAgent(convex: Convex, workspaceId: string, agentId: string) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspacePrincipals', { principalId: `agent-${agentId}`, workspaceId, type: 'agent', agentId, displayName: agentId, createdAt: now, updatedAt: now })
  })
  return `agent-${agentId}`
}

const mk = async (convex: Convex, args: Record<string, unknown>) => (await convex.mutation(create, { ...call, ...args })) as string
const upd = async (convex: Convex, args: Record<string, unknown>) => await convex.mutation(update, { ...call, ...args })
const row = async (convex: Convex, id: string) => await convex.run(async (ctx) => await ctx.db.get(id as never) as unknown as Item)
const W = { workspaceId: 'w1' }

async function workspace() {
  const convex = convexTest(schema, modules)
  await addMember(convex, 'w1', 'u1', 'owner')
  await addMember(convex, 'w1', 'u2')
  return convex
}

// ---------- tree shape ----------

test('an item that already has subtasks cannot become a subtask', async () => {
  const convex = await workspace()
  const a = await mk(convex, { userId: 'u1', ...W, title: 'A' })
  await mk(convex, { userId: 'u1', ...W, title: 'A1', parentItemId: a })
  const b = await mk(convex, { userId: 'u1', ...W, title: 'B' })
  await expect(upd(convex, { itemId: a, userId: 'u1', ...W, parentItemId: b })).rejects.toThrow(/WORK_ITEM_PARENT_INVALID/)
  expect((await row(convex, a)).parentItemId).toBeUndefined()
})

test('a subtask can be moved to another parent and promoted back to top level', async () => {
  const convex = await workspace()
  const a = await mk(convex, { userId: 'u1', ...W, title: 'A' })
  const b = await mk(convex, { userId: 'u1', ...W, title: 'B' })
  const child = await mk(convex, { userId: 'u1', ...W, title: 'child', parentItemId: a })
  await upd(convex, { itemId: child, userId: 'u1', ...W, parentItemId: b })
  expect((await row(convex, child)).parentItemId).toBe(b)
  await upd(convex, { itemId: child, userId: 'u1', ...W, clearParent: true })
  const promoted = await row(convex, child)
  expect(promoted.parentItemId).toBeUndefined()
  // It lands at the end of the top-level column, after A and B.
  expect(promoted.orderKey > (await row(convex, b)).orderKey).toBe(true)
  await expect(upd(convex, { itemId: child, userId: 'u1', ...W, clearParent: true, parentItemId: a })).rejects.toThrow(/WORK_ITEM_PARENT_INVALID/)
})

test('a subtask must share its parent\'s workspace and scope', async () => {
  const convex = await workspace()
  await addMember(convex, 'w2', 'u1', 'owner')
  const shared = await mk(convex, { userId: 'u1', ...W, title: 'Shared', scope: 'workspace' })
  const mine = await mk(convex, { userId: 'u1', ...W, title: 'Mine', scope: 'personal' })
  const other = await mk(convex, { userId: 'u1', workspaceId: 'w2', title: 'Other workspace' })

  await expect(mk(convex, { userId: 'u1', ...W, title: 'x', scope: 'personal', parentItemId: shared })).rejects.toThrow(/WORK_ITEM_PARENT_INVALID/)
  await expect(mk(convex, { userId: 'u1', ...W, title: 'x', scope: 'workspace', parentItemId: mine })).rejects.toThrow(/WORK_ITEM_PARENT_INVALID/)
  await expect(mk(convex, { userId: 'u1', ...W, title: 'x', parentItemId: other })).rejects.toThrow(/WORK_ITEM_PARENT_INVALID/)

  const sub = await mk(convex, { userId: 'u1', ...W, title: 'sub', scope: 'workspace', parentItemId: shared })
  // The same rules apply when re-parenting.
  const loose = await mk(convex, { userId: 'u1', ...W, title: 'loose personal' })
  await expect(upd(convex, { itemId: loose, userId: 'u1', ...W, parentItemId: shared })).rejects.toThrow(/WORK_ITEM_PARENT_INVALID/)
  await expect(upd(convex, { itemId: sub, userId: 'u1', ...W, parentItemId: other })).rejects.toThrow(/WORK_ITEM_PARENT_INVALID/)
  // Neither an archived nor a deleted parent will do.
  await expect(upd(convex, { itemId: sub, userId: 'u1', ...W, parentItemId: sub })).rejects.toThrow(/WORK_ITEM_PARENT_INVALID/)
})

test('a subtask only changes scope with its parent, and everything gets a number in the new scope', async () => {
  const convex = await workspace()
  const otherMember = await addMember(convex, 'w1', 'u3')
  const parent = await mk(convex, { userId: 'u1', ...W, title: 'Parent', scope: 'workspace', assigneeUserId: otherMember })
  const child = await mk(convex, { userId: 'u1', ...W, title: 'Child', scope: 'workspace', parentItemId: parent })
  await mk(convex, { userId: 'u1', ...W, title: 'Private 1', scope: 'personal' })

  expect(await convex.mutation(setScope, { ...call, id: child, userId: 'u1', ...W, to: 'personal' }))
    .toEqual({ ok: false, reason: 'subtask_follows_parent' })

  expect(await convex.mutation(setScope, { ...call, id: parent, userId: 'u1', ...W, to: 'personal' })).toEqual({ ok: true })
  const movedParent = await row(convex, parent)
  const movedChild = await row(convex, child)
  expect(movedParent.scope).toBe('personal')
  expect(movedChild.scope).toBe('personal')
  // u1's personal counter had 1 (Private 1); parent and child continue it.
  expect([movedParent.itemNumber, movedChild.itemNumber]).toEqual([2, 3])
  // The assignee could not see a private item, so the assignment is dropped.
  expect(movedParent.assigneeUserId).toBeUndefined()
})

// ---------- assignee ----------

test('the assignee must be an active member or agent of the item\'s workspace', async () => {
  const convex = await workspace()
  const u2 = 'p-w1-u2'
  const suspended = await addMember(convex, 'w1', 'u3', 'member', 'suspended')
  const outsider = await addMember(convex, 'w2', 'u9')
  const agent = await addAgent(convex, 'w1', 'a1')
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspacePrincipals', { principalId: 'gone', workspaceId: 'w1', type: 'human', userId: 'u4', displayName: 'gone', createdAt: now, updatedAt: now, archivedAt: now })
  })

  const shared = { userId: 'u1', ...W, scope: 'workspace', title: 't' }
  for (const bad of ['stranger', suspended, outsider, 'gone']) {
    await expect(mk(convex, { ...shared, assigneeUserId: bad })).rejects.toThrow(/WORK_ITEM_ASSIGNEE_INVALID/)
  }
  const ok = await mk(convex, { ...shared, assigneeUserId: u2 })
  expect((await row(convex, ok)).assigneeUserId).toBe(u2)
  await mk(convex, { ...shared, assigneeUserId: agent })

  // Updates are checked too, and clearing still works.
  const id = await mk(convex, shared)
  await expect(upd(convex, { itemId: id, userId: 'u1', ...W, assigneeUserId: 'stranger' })).rejects.toThrow(/WORK_ITEM_ASSIGNEE_INVALID/)
  await upd(convex, { itemId: id, userId: 'u1', ...W, assigneeUserId: u2 })
  await upd(convex, { itemId: id, userId: 'u1', ...W, clearAssignee: true })
  expect((await row(convex, id)).assigneeUserId).toBeUndefined()

  // A private item can go to its creator, not to someone who could never see it. No workspace, no assignee.
  await expect(mk(convex, { userId: 'u1', ...W, title: 'p', assigneeUserId: u2 })).rejects.toThrow(/WORK_ITEM_ASSIGNEE_INVALID/)
  await mk(convex, { userId: 'u1', ...W, title: 'p', assigneeUserId: 'p-w1-u1' })
  await expect(mk(convex, { userId: 'u1', title: 'legacy', assigneeUserId: 'p-w1-u1' })).rejects.toThrow(/WORK_ITEM_ASSIGNEE_INVALID/)
})

// ---------- numbering ----------

test('private items do not move the workspace\'s numbers', async () => {
  const convex = await workspace()
  const n = async (id: string) => (await row(convex, id)).itemNumber
  const s1 = await mk(convex, { userId: 'u1', ...W, title: 's1', scope: 'workspace' })
  for (let i = 0; i < 5; i++) await mk(convex, { userId: 'u2', ...W, title: `private ${i}` })
  const p1 = await mk(convex, { userId: 'u1', ...W, title: 'p1' })
  const s2 = await mk(convex, { userId: 'u2', ...W, title: 's2', scope: 'workspace' })
  expect([await n(s1), await n(s2)]).toEqual([1, 2])
  expect(await n(p1)).toBe(1)
})

// ---------- limits ----------

test('oversized or malformed fields are refused', async () => {
  const convex = await workspace()
  const ok = await mk(convex, { userId: 'u1', ...W, title: 'fine' })
  await expect(mk(convex, { userId: 'u1', ...W, title: 'x'.repeat(201) })).rejects.toThrow(/WORK_ITEM_INVALID:title/)
  await expect(mk(convex, { userId: 'u1', ...W, title: 't', description: 'x'.repeat(20_001) })).rejects.toThrow(/WORK_ITEM_INVALID:description/)
  await expect(mk(convex, { userId: 'u1', ...W, title: 't', labels: Array.from({ length: 21 }, (_, i) => `l${i}`) })).rejects.toThrow(/WORK_ITEM_INVALID:labels/)
  await expect(mk(convex, { userId: 'u1', ...W, title: 't', labels: ['x'.repeat(51)] })).rejects.toThrow(/WORK_ITEM_INVALID:labels/)
  await expect(mk(convex, { userId: 'u1', ...W, title: 't', labels: [' '] })).rejects.toThrow(/WORK_ITEM_INVALID:labels/)
  await expect(mk(convex, { userId: 'u1', ...W, title: 't', orderKey: 'abc' })).rejects.toThrow(/WORK_ITEM_INVALID:orderKey/)
  await expect(upd(convex, { itemId: ok, userId: 'u1', ...W, orderKey: '12' })).rejects.toThrow(/WORK_ITEM_INVALID:orderKey/)
  await expect(upd(convex, { itemId: ok, userId: 'u1', ...W, title: 'x'.repeat(201) })).rejects.toThrow(/WORK_ITEM_INVALID:title/)
  await expect(convex.mutation(reorder, { ...call, itemId: ok, userId: 'u1', ...W, orderKey: 'zz' })).rejects.toThrow(/WORK_ITEM_INVALID:orderKey/)
  // Exactly at the limits is fine, and labels are trimmed and de-duplicated.
  const edge = await mk(convex, { userId: 'u1', ...W, title: 'x'.repeat(200), labels: ['a', ' a ', 'b'] })
  expect(((await row(convex, edge)) as unknown as { labels: string[] }).labels).toEqual(['a', 'b'])
})

// ---------- clearing ----------

test('start date, due date, or both can be cleared on their own', async () => {
  const convex = await workspace()
  const id = await mk(convex, { userId: 'u1', ...W, title: 'dated', startDate: 1000, dueDate: 2000 })
  await upd(convex, { itemId: id, userId: 'u1', ...W, clearStartDate: true })
  expect([(await row(convex, id)).startDate, (await row(convex, id)).dueDate]).toEqual([undefined, 2000])
  await upd(convex, { itemId: id, userId: 'u1', ...W, startDate: 1500, clearDueDate: true })
  expect([(await row(convex, id)).startDate, (await row(convex, id)).dueDate]).toEqual([1500, undefined])
  await upd(convex, { itemId: id, userId: 'u1', ...W, startDate: 1, dueDate: 2 })
  await upd(convex, { itemId: id, userId: 'u1', ...W, clearDates: true })
  expect([(await row(convex, id)).startDate, (await row(convex, id)).dueDate]).toEqual([undefined, undefined])
})

// ---------- ordering ----------

test('appending ignores other people\'s private items and other columns', async () => {
  const convex = await workspace()
  const a = await mk(convex, { userId: 'u1', ...W, title: 'A' })
  for (let i = 0; i < 3; i++) await mk(convex, { userId: 'u2', ...W, title: `u2 ${i}` })
  await mk(convex, { userId: 'u1', ...W, title: 'doing', status: 'in_progress' })
  const b = await mk(convex, { userId: 'u1', ...W, title: 'B' })
  const [ka, kb] = [(await row(convex, a)).orderKey, (await row(convex, b)).orderKey]
  expect(ka < kb).toBe(true)
  // Right after A in u1's own column: one step, not pushed up by u2's items.
  expect(BigInt(kb) - BigInt(ka)).toBe(BigInt(1024))
})

// ---------- reading ----------

test('someone outside the workspace cannot read an item or its search hits', async () => {
  const convex = await workspace()
  const id = await mk(convex, { userId: 'u1', ...W, title: 'Quarterly report', scope: 'workspace' })
  expect(await convex.query(get, { ...call, itemId: id, userId: 'u9', ...W })).toBeNull()
  expect(await convex.query(get, { ...call, itemId: id, userId: 'u9' })).toBeNull()
  expect(await convex.query(search, { ...call, userId: 'u9', ...W, text: 'report' })).toEqual([])
  expect(((await convex.query(get, { ...call, itemId: id, userId: 'u2', ...W })) as { item: Item } | null)?.item.title).toBe('Quarterly report')
})

test('search sees own and shared items; other people\'s private matches cannot crowd them out', async () => {
  const convex = await workspace()
  for (let i = 0; i < 40; i++) await mk(convex, { userId: 'u2', ...W, title: `report draft ${i}` })
  await mk(convex, { userId: 'u1', ...W, title: 'Shared report', scope: 'workspace' })
  await mk(convex, { userId: 'u1', ...W, title: 'My private report' })
  const archived = await mk(convex, { userId: 'u1', ...W, title: 'Archived report', scope: 'workspace' })
  await convex.mutation(makeFunctionReference<'mutation'>('work/items:archive'), { ...call, id: archived, userId: 'u1', ...W })
  const gone = await mk(convex, { userId: 'u1', ...W, title: 'Deleted report', scope: 'workspace' })
  await convex.mutation(makeFunctionReference<'mutation'>('work/items:remove'), { ...call, itemId: gone, userId: 'u1', ...W })

  const titles = async (userId: string, limit = 5) =>
    ((await convex.query(search, { ...call, userId, ...W, text: 'report', limit })) as Item[]).map((i) => i.title).sort()
  expect(await titles('u1')).toEqual(['My private report', 'Shared report'])

  // u2 has 40 private matches, but a limit of 5 still reaches the shared item.
  const forU2 = await titles('u2')
  expect(forU2).toContain('Shared report')
  expect(forU2).not.toContain('My private report')
  expect(forU2.length).toBe(5)
})
