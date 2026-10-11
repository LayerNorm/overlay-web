import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'work-items-secret'
const now = 1_900_000_000_000
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const list = makeFunctionReference<'query'>('work/items:list')
const get = makeFunctionReference<'query'>('work/items:get')
const create = makeFunctionReference<'mutation'>('work/items:create')
const update = makeFunctionReference<'mutation'>('work/items:update')
const reorder = makeFunctionReference<'mutation'>('work/items:reorder')
const remove = makeFunctionReference<'mutation'>('work/items:remove')
const archive = makeFunctionReference<'mutation'>('work/items:archive')
const restore = makeFunctionReference<'mutation'>('work/items:restore')

type Item = {
  _id: string
  userId: string
  title: string
  status: string
  scope?: string
  orderKey: string
  itemNumber: number
  archivedAt?: number
  deletedAt?: number
  parentItemId?: string
}

async function addMember(convex: ReturnType<typeof convexTest>, workspaceId: string, userId: string, role: 'owner' | 'member' | 'guest' = 'member') {
  await convex.run(async (ctx) => {
    const principalId = `p-${workspaceId}-${userId}`
    await ctx.db.insert('workspacePrincipals', {
      principalId, workspaceId, type: 'human', userId, displayName: userId, createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: `m-${principalId}`, workspaceId, principalId, role, status: 'active', joinedAt: now, updatedAt: now,
    })
  })
}

const call = { serverSecret: secret }

async function createItem(convex: ReturnType<typeof convexTest>, args: Record<string, unknown>): Promise<string> {
  return (await convex.mutation(create, { ...call, ...args })) as string
}

async function listItems(convex: ReturnType<typeof convexTest>, args: Record<string, unknown>): Promise<Item[]> {
  return (await convex.query(list, { ...call, ...args })) as Item[]
}

test('personal items belong to their creator; item numbers count per scope', async () => {
  const convex = convexTest(schema, modules)
  await addMember(convex, 'w1', 'u1', 'owner')
  await addMember(convex, 'w1', 'u2')

  const id1 = await createItem(convex, { userId: 'u1', workspaceId: 'w1', title: 'First task' })
  const id2 = await createItem(convex, { userId: 'u1', workspaceId: 'w1', title: 'Second task' })
  await createItem(convex, { userId: 'u2', workspaceId: 'w1', title: 'U2 personal', scope: 'personal' })
  await createItem(convex, { userId: 'u1', workspaceId: 'w1', title: 'Shared task', scope: 'workspace' })

  // Personal view: u1 sees only their own; u2's personal item is hidden.
  const personal = await listItems(convex, { userId: 'u1', workspaceId: 'w1', view: 'personal' })
  expect(personal.map((i) => i.title)).toEqual(['First task', 'Second task'])

  // Workspace view: u2 sees shared items from u1, but not u1's personal ones.
  const workspace = await listItems(convex, { userId: 'u2', workspaceId: 'w1', view: 'workspace' })
  expect(workspace.map((i) => i.title)).toEqual(['Shared task'])

  // OVR numbers come from one counter per workspace: personal and shared items
  // in w1 share the sequence so keys are unique within the workspace.
  const items = await convex.run(async (ctx) => await ctx.db.query('workItems').collect() as Item[])
  const byId = new Map(items.map((i) => [i._id, i]))
  expect(byId.get(id1)!.itemNumber).toBe(1)
  expect(byId.get(id2)!.itemNumber).toBe(2)
  expect(byId.get((await listItems(convex, { userId: 'u1', workspaceId: 'w1', view: 'workspace' }))[0]!._id)!.itemNumber).toBe(4)
})

test('workspace-scoped items are readable by members only; edits enforced', async () => {
  const convex = convexTest(schema, modules)
  await addMember(convex, 'w1', 'u1', 'owner')
  await addMember(convex, 'w1', 'u2')
  await addMember(convex, 'w1', 'u3', 'admin')
  // u4 is not a member of w1.

  const sharedId = await createItem(convex, { userId: 'u1', workspaceId: 'w1', title: 'Shared', scope: 'workspace' })

  // A non-member cannot read or edit the workspace item.
  expect(await listItems(convex, { userId: 'u4', workspaceId: 'w1' })).toEqual([])
  await expect(convex.mutation(update, { ...call, itemId: sharedId, userId: 'u4', workspaceId: 'w1', title: 'hijack' }))
    .rejects.toThrow()

  // A member can read it but cannot edit someone else's workspace item (creator/admins only).
  expect(await listItems(convex, { userId: 'u2', workspaceId: 'w1' })).not.toEqual([])
  await expect(convex.mutation(update, { ...call, itemId: sharedId, userId: 'u2', workspaceId: 'w1', title: 'hijack' }))
    .rejects.toThrow()

  // An admin can edit it.
  await convex.mutation(update, { ...call, itemId: sharedId, userId: 'u3', workspaceId: 'w1', title: 'Shared (edited)' })
  const detail = await convex.query(get, { ...call, itemId: sharedId, userId: 'u3', workspaceId: 'w1' }) as { item: Item } | null
  expect(detail?.item.title).toBe('Shared (edited)')
})

test('status changes re-seat orderKey; reorder writes status and key', async () => {
  const convex = convexTest(schema, modules)
  await addMember(convex, 'w1', 'u1', 'owner')

  const a = await createItem(convex, { userId: 'u1', workspaceId: 'w1', title: 'A' })
  const b = await createItem(convex, { userId: 'u1', workspaceId: 'w1', title: 'B' })
  const c = await createItem(convex, { userId: 'u1', workspaceId: 'w1', title: 'C' })

  let items = await listItems(convex, { userId: 'u1', workspaceId: 'w1' })
  expect(items.map((i) => i.title)).toEqual(['A', 'B', 'C'])
  const keys = items.map((i) => i.orderKey)
  expect(keys[0]! < keys[1]! && keys[1]! < keys[2]!).toBe(true)

  // Moving B to in_progress re-seats it at the end of the target column.
  await convex.mutation(update, { ...call, itemId: b, userId: 'u1', workspaceId: 'w1', status: 'in_progress' })
  // Drag C above A: orderKey between '' and A's key.
  const aKey = items.find((i) => i._id === a)!.orderKey
  const mid = (BigInt(aKey) / BigInt(2)).toString().padStart(20, '0')
  await convex.mutation(reorder, { ...call, itemId: c, userId: 'u1', workspaceId: 'w1', orderKey: mid })

  items = await listItems(convex, { userId: 'u1', workspaceId: 'w1', status: 'todo' })
  expect(items.map((i) => i.title)).toEqual(['C', 'A'])
  const doing = await listItems(convex, { userId: 'u1', workspaceId: 'w1', status: 'in_progress' })
  expect(doing.map((i) => i.title)).toEqual(['B'])
})

test('archive hides items; restore returns them; remove cascades to subtasks', async () => {
  const convex = convexTest(schema, modules)
  await addMember(convex, 'w1', 'u1', 'owner')

  const parent = await createItem(convex, { userId: 'u1', workspaceId: 'w1', title: 'Parent' })
  const child = await createItem(convex, { userId: 'u1', workspaceId: 'w1', title: 'Child', parentItemId: parent })

  // Nested subtask under a subtask is refused.
  await expect(createItem(convex, { userId: 'u1', workspaceId: 'w1', title: 'Grandchild', parentItemId: child }))
    .rejects.toThrow()

  const detail = await convex.query(get, { ...call, itemId: parent, userId: 'u1', workspaceId: 'w1' }) as { children: Item[] } | null
  expect(detail?.children.map((c) => c.title)).toEqual(['Child'])

  // Archive: parent and its subtasks leave the default list; restore brings them back.
  await convex.mutation(archive, { ...call, id: parent, userId: 'u1', workspaceId: 'w1' })
  expect(await listItems(convex, { userId: 'u1', workspaceId: 'w1' })).toEqual([])
  const archived = await listItems(convex, { userId: 'u1', workspaceId: 'w1', view: 'archived' })
  expect(archived.map((i) => i.title).sort()).toEqual(['Child', 'Parent'])
  await convex.mutation(restore, { ...call, id: parent, userId: 'u1', workspaceId: 'w1' })
  expect((await listItems(convex, { userId: 'u1', workspaceId: 'w1' })).map((i) => i.title).sort()).toEqual(['Child', 'Parent'])

  // Remove soft-deletes the parent and its subtasks.
  await convex.mutation(remove, { ...call, itemId: parent, userId: 'u1', workspaceId: 'w1' })
  expect(await listItems(convex, { userId: 'u1', workspaceId: 'w1' })).toEqual([])
  const rows = await convex.run(async (ctx) => await ctx.db.query('workItems').collect() as Item[])
  expect(rows.every((row) => row.deletedAt !== undefined)).toBe(true)
})

test('expectedUpdatedAt guards stale writes', async () => {
  const convex = convexTest(schema, modules)
  await addMember(convex, 'w1', 'u1', 'owner')
  const id = await createItem(convex, { userId: 'u1', workspaceId: 'w1', title: 'Guarded' })

  await convex.mutation(update, { ...call, itemId: id, userId: 'u1', workspaceId: 'w1', title: 'Guarded v2' })
  const detail = await convex.query(get, { ...call, itemId: id, userId: 'u1', workspaceId: 'w1' }) as { item: { updatedAt: number } } | null
  const fresh = detail!.item.updatedAt
  await expect(convex.mutation(update, { ...call, itemId: id, userId: 'u1', workspaceId: 'w1', title: 'stale', expectedUpdatedAt: fresh - 1 }))
    .rejects.toThrow(/WORK_ITEM_REVISION_CONFLICT/)
  await convex.mutation(update, { ...call, itemId: id, userId: 'u1', workspaceId: 'w1', title: 'fresh', expectedUpdatedAt: fresh })
})
