import { beforeAll, describe, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { parseUpdateWorkItem } from '../src/server/work/work-input'

const modules = import.meta.glob('./**/*.ts')
const secret = 'work-secret'
const now = 1_900_000_000_000
const workspaceId = 'ws-work'
const otherWorkspaceId = 'ws-other'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const q = (name: string) => makeFunctionReference<'query'>(name)
const m = (name: string) => makeFunctionReference<'mutation'>(name)

type Convex = ReturnType<typeof convexTest>
type Item = { _id: string; title: string; status: string; rank: string; scope: string; parentId?: string; assigneePrincipalId?: string; archivedAt?: number; blocked: boolean; updatedAt: number }

/** A workspace with an owner, an admin, two members, a guest, and an agent. */
async function seed(convex: Convex, policy?: Record<string, unknown>) {
  await convex.run(async (ctx) => {
    for (const ws of [workspaceId, otherWorkspaceId]) {
      await ctx.db.insert('workspaces', { workspaceId: ws, kind: 'organization', name: ws, slug: ws, status: 'active', createdAt: now, updatedAt: now })
    }
    for (const [userId, role] of [['owner', 'owner'], ['admin', 'admin'], ['alice', 'member'], ['bob', 'member'], ['gus', 'guest']] as const) {
      await ctx.db.insert('workspacePrincipals', { principalId: `p-${userId}`, workspaceId, type: 'human', userId, displayName: userId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { membershipId: `m-${userId}`, workspaceId, principalId: `p-${userId}`, role, status: 'active', joinedAt: now, updatedAt: now })
    }
    await ctx.db.insert('workspacePrincipals', { principalId: 'p-agent', workspaceId, type: 'agent', agentId: 'agent-1', displayName: 'Researcher', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspacePrincipals', { principalId: 'p-archived-actor', workspaceId, type: 'agent', agentId: 'archived-actor', displayName: 'Archived agent', archivedAt: now, createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceAgentDefinitions', {
      principalId: 'p-agent', agentId: 'agent-1', workspaceId, name: 'Researcher', instructions: 'Research.',
      harness: 'overlay', modelId: 'test-model', allowedToolIds: [], invocationPolicy: 'mention',
      visibility: 'workspace', createdByPrincipalId: 'p-owner', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', { principalId: 'p-outsider', workspaceId: otherWorkspaceId, type: 'human', userId: 'outsider', displayName: 'outsider', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspacePrincipals', { principalId: 'p-agent-other', workspaceId: otherWorkspaceId, type: 'agent', agentId: 'agent-other', displayName: 'Other agent', createdAt: now, updatedAt: now })
    await ctx.db.insert('workspaceMemberships', { membershipId: 'm-outsider', workspaceId: otherWorkspaceId, principalId: 'p-outsider', role: 'owner', status: 'active', joinedAt: now, updatedAt: now })
    if (policy) await ctx.db.insert('workspaceSharingPolicies', { workspaceId, publicLinksEnabled: true, createdAt: now, updatedAt: now, ...policy })
  })
}

async function addAgent(
  convex: Convex,
  args: {
    principalId: string
    agentId: string
    creatorPrincipalId: string
    visibility: 'workspace' | 'creator'
    archivedPrincipal?: boolean
    archivedDefinition?: boolean
    deletedDefinition?: boolean
    avatarColor?: string
    avatarShape?: string
  },
) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspacePrincipals', {
      principalId: args.principalId, workspaceId, type: 'agent', agentId: args.agentId, displayName: args.principalId,
      createdAt: now, updatedAt: now, ...(args.archivedPrincipal ? { archivedAt: now } : {}),
    })
    await ctx.db.insert('workspaceAgentDefinitions', {
      principalId: args.principalId, agentId: args.agentId, workspaceId, name: args.principalId, instructions: 'Test agent.',
      harness: 'overlay', modelId: 'test-model', allowedToolIds: [], invocationPolicy: 'mention',
      visibility: args.visibility, createdByPrincipalId: args.creatorPrincipalId, createdAt: now, updatedAt: now,
      ...(args.avatarColor !== undefined ? { avatarColor: args.avatarColor } : {}),
      ...(args.avatarShape !== undefined ? { avatarShape: args.avatarShape } : {}),
      ...(args.archivedDefinition ? { archivedAt: now } : {}),
      ...(args.deletedDefinition ? { deletedAt: now } : {}),
    })
  })
}

const auth = (userId: string, ws = workspaceId) => ({ serverSecret: secret, workspaceId: ws, userId })

function api(convex: Convex) {
  return {
    create: (userId: string, args: Record<string, unknown>) => convex.mutation(m('work/workItems:create'), { ...auth(userId), title: 'Task', ...args }) as Promise<Item>,
    update: (userId: string, id: string, args: Record<string, unknown>) => convex.mutation(m('work/workItems:update'), { ...auth(userId), id, ...args }) as Promise<Item>,
    move: (userId: string, id: string, args: Record<string, unknown>) => convex.mutation(m('work/workItems:move'), { ...auth(userId), id, ...args }) as Promise<Item>,
    list: async (userId: string, view?: string) => (await convex.query(q('work/workItems:list'), { ...auth(userId), ...(view ? { view } : {}) })) as Item[],
    titles: async (userId: string, view?: string) => (await convex.query(q('work/workItems:list'), { ...auth(userId), ...(view ? { view } : {}) }) as Item[]).map((i) => i.title),
    get: (userId: string, id: string) => convex.query(q('work/workItems:get'), { ...auth(userId), id }) as Promise<Item | null>,
    setScope: (userId: string, id: string, to: string) => convex.mutation(m('work/workItems:setScope'), { ...auth(userId), id, to }),
    archive: (userId: string, id: string) => convex.mutation(m('work/workItems:archive'), { ...auth(userId), id }),
    restore: (userId: string, id: string) => convex.mutation(m('work/workItems:restore'), { ...auth(userId), id }),
    events: async (userId: string, workItemId: string) => (await convex.query(q('work/workItemEvents:list'), { ...auth(userId), workItemId })) as Array<{ kind: string; data?: Record<string, unknown>; actorPrincipalId: string }>,
    remove: (userId: string, id: string) => convex.mutation(m('work/workItems:remove'), { ...auth(userId), id }),
    comment: (userId: string, workItemId: string, body: string) => convex.mutation(m('work/workItemEvents:addComment'), { ...auth(userId), workItemId, body }),
  }
}

test('a stale API update cannot overwrite a newer task mutation', async () => {
  const convex = convexTest(schema, modules)
  await seed(convex)
  const work = api(convex)
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  try {
    const original = await work.create('alice', { title: 'Original' })
    clock.mockReturnValue(now + 1)
    await work.update('alice', original._id, { title: 'Newer human edit' })
    const stale = parseUpdateWorkItem({ title: 'Stale agent edit', expectedUpdatedAt: original.updatedAt })
    await expect(work.update('alice', original._id, { ...stale })).rejects.toThrow(/WORK_INVALID:conflict/)
    expect((await work.get('alice', original._id))?.title).toBe('Newer human edit')
  } finally {
    clock.mockRestore()
  }
})

test('field, status and scope updates commit together or leave the task and activity unchanged', async () => {
  const convex = convexTest(schema, modules)
  await seed(convex)
  const work = api(convex)
  const original = await work.create('alice', { title: 'Original', startDate: '2030-01-02' })
  const before = await work.events('alice', original._id)
  await expect(work.update('alice', original._id, {
    ...parseUpdateWorkItem({ title: 'Invalid edit', scope: 'workspace', status: 'done', dueDate: '2030-01-01' }),
  })).rejects.toThrow(/date_order/)
  expect(await work.get('alice', original._id)).toMatchObject({ title: 'Original', scope: 'personal', status: 'todo' })
  expect(await work.events('alice', original._id)).toEqual(before)

  const changed = await work.update('alice', original._id, {
    ...parseUpdateWorkItem({ title: 'Complete edit', scope: 'workspace', status: 'done', expectedUpdatedAt: original.updatedAt }),
  })
  expect(changed).toMatchObject({ title: 'Complete edit', scope: 'workspace', status: 'done' })
  expect(await work.get('bob', original._id)).toMatchObject({ title: 'Complete edit', scope: 'workspace', status: 'done' })
})

test('a comment cannot resurrect an obsolete revision after a same-tick edit', async () => {
  const convex = convexTest(schema, modules)
  await seed(convex)
  const work = api(convex)
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  try {
    const original = await work.create('alice', { title: 'Original' })
    const edited = await work.update('alice', original._id, {
      title: 'Newer human edit', expectedUpdatedAt: original.updatedAt,
    })
    await work.comment('alice', original._id, 'Keep the newer edit')
    await expect(work.update('alice', original._id, {
      title: 'Stale agent edit', expectedUpdatedAt: original.updatedAt,
    })).rejects.toThrow(/WORK_INVALID:conflict/)
    const current = await work.get('alice', original._id)
    expect(current?.title).toBe('Newer human edit')
    expect(current?.updatedAt).toBeGreaterThan(edited.updatedAt)
    expect((await work.events('alice', original._id)).at(-1)).toMatchObject({
      kind: 'comment', data: { body: 'Keep the newer edit' },
    })
  } finally {
    clock.mockRestore()
  }
})

test('task revisions advance for edits, moves and archive/restore within one clock tick', async () => {
  const convex = convexTest(schema, modules)
  await seed(convex)
  const work = api(convex)
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  try {
    const original = await work.create('alice', { title: 'Original' })
    let previous = original.updatedAt
    for (const change of [
      () => work.update('alice', original._id, { title: 'Changed' }),
      () => work.comment('alice', original._id, 'Same-tick comment'),
      () => work.move('alice', original._id, { status: 'progress' }),
      () => work.setScope('alice', original._id, 'workspace'),
      () => work.archive('alice', original._id),
      () => work.restore('alice', original._id),
    ]) {
      await change()
      const current = await convex.run((ctx) => ctx.db.get(original._id as import('./_generated/dataModel').Id<'workItems'>))
      expect(current?.updatedAt).toBeGreaterThan(previous)
      previous = current!.updatedAt
    }
  } finally {
    clock.mockRestore()
  }
})

describe('personal and workspace visibility', () => {
  test('personal tasks are private; workspace tasks are shared with members but not guests or other workspaces', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    await work.create('alice', { title: 'Mine' })
    await work.create('alice', { title: 'Ours', scope: 'workspace' })
    await work.create('bob', { title: 'Bobs own', scope: 'workspace' })

    expect(await work.titles('alice')).toEqual(['Mine', 'Ours', 'Bobs own'])
    expect(await work.titles('bob')).toEqual(['Ours', 'Bobs own'])
    expect(await work.titles('owner')).toEqual(['Ours', 'Bobs own'])
    expect(await work.titles('gus')).toEqual([])
    expect(await work.titles('outsider')).toEqual([])
    expect(await work.titles('alice', 'personal')).toEqual(['Mine'])
    expect(await work.titles('alice', 'workspace')).toEqual(['Ours', 'Bobs own'])
    expect(await convex.query(q('work/workItems:list'), { ...auth('outsider', otherWorkspaceId) })).toEqual([])
  })

  test('another member cannot read, update, move, comment on, or archive a personal task', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const secretTask = await work.create('alice', { title: 'Private' })
    expect(await work.get('bob', secretTask._id)).toBeNull()
    expect(await work.get('admin', secretTask._id)).toBeNull()
    await expect(work.update('bob', secretTask._id, { title: 'x' })).rejects.toThrow(/Unauthorized/)
    await expect(work.move('owner', secretTask._id, { status: 'done' })).rejects.toThrow(/Unauthorized/)
    await expect(work.comment('bob', secretTask._id, 'hi')).rejects.toThrow(/Unauthorized/)
    expect(await work.archive('admin', secretTask._id)).toEqual({ ok: false, reason: 'not_found' })
    expect(await work.events('bob', secretTask._id)).toEqual([])
    // Reading it with another workspace's id does not find it either.
    expect(await convex.query(q('work/workItems:get'), { ...auth('alice', otherWorkspaceId), id: secretTask._id })).toBeNull()
  })

  test('the workspace policy decides who may create in the workspace', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex, { workspaceContentEditors: 'admins' })
    const work = api(convex)
    await expect(work.create('alice', { title: 'No', scope: 'workspace' })).rejects.toThrow(/workspace_creation_restricted/)
    expect((await work.create('admin', { title: 'Yes', scope: 'workspace' })).scope).toBe('workspace')
    expect((await work.create('alice', { title: 'Personal still fine' })).scope).toBe('personal')
    await expect(work.create('gus', { title: 'Guest' })).rejects.toThrow()
  })

  test('members may work on a workspace task when the policy allows, and only on assigned ones when admins-only', async () => {
    const open = convexTest(schema, modules)
    await seed(open)
    const task = await api(open).create('alice', { title: 'Shared', scope: 'workspace' })
    expect((await api(open).update('bob', task._id, { status: 'progress' })).status).toBe('progress')
    await expect(api(open).update('gus', task._id, { status: 'done' })).rejects.toThrow()

    const strict = convexTest(schema, modules)
    await seed(strict, { workspaceContentEditors: 'admins' })
    const work = api(strict)
    const adminTask = await work.create('admin', { title: 'Admin task', scope: 'workspace', assigneePrincipalId: 'p-bob' })
    await expect(work.update('alice', adminTask._id, { status: 'progress' })).rejects.toThrow(/Unauthorized/)
    expect((await work.update('bob', adminTask._id, { status: 'progress' })).status).toBe('progress')
  })
})

test('acting agent attribution is validated and applied to Work activity only', async () => {
  const convex = convexTest(schema, modules)
  await seed(convex)
  const task = await api(convex).create('alice', { actingAgentPrincipalId: 'p-agent' })
  await convex.mutation(m('work/workItems:update'), { ...auth('alice'), id: task._id, title: 'Updated', actingAgentPrincipalId: 'p-agent' })
  await convex.mutation(m('work/workItems:move'), { ...auth('alice'), id: task._id, status: 'progress', actingAgentPrincipalId: 'p-agent' })
  await convex.mutation(m('work/workItemEvents:addComment'), { ...auth('alice'), workItemId: task._id, body: 'Review this', actingAgentPrincipalId: 'p-agent' })
  await convex.mutation(m('work/workItems:archive'), { ...auth('alice'), id: task._id, actingAgentPrincipalId: 'p-agent' })
  await convex.mutation(m('work/workItems:restore'), { ...auth('alice'), id: task._id, actingAgentPrincipalId: 'p-agent' })
  const events = await api(convex).events('alice', task._id)
  expect(events.length).toBeGreaterThanOrEqual(5)
  expect(events.every((event) => event.actorPrincipalId === 'p-agent')).toBe(true)

  for (const actingAgentPrincipalId of ['p-alice', 'p-archived-actor', 'p-agent-other']) {
    await expect(api(convex).create('alice', { actingAgentPrincipalId })).rejects.toThrow('WORK_INVALID:acting_agent')
  }
})

describe('move, archive and restore', () => {
  test('only the creator moves a task; archive and restore follow the shared rules and keep children with it', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const objective = await work.create('alice', { title: 'Objective' })
    const child = await work.create('alice', { title: 'Child', parentId: objective._id })

    expect(await work.setScope('bob', objective._id, 'workspace')).toEqual({ ok: false, reason: 'not_found' })
    expect(await work.setScope('alice', objective._id, 'workspace')).toEqual({ ok: true })
    expect(await work.titles('bob')).toEqual(['Objective', 'Child'])
    expect(await work.setScope('admin', objective._id, 'personal')).toEqual({ ok: false, reason: 'not_creator' })
    expect(await work.setScope('alice', objective._id, 'workspace')).toEqual({ ok: false, reason: 'same_scope' })

    // An admin may archive a member's workspace task; it leaves the workspace view and shows under Archived.
    expect(await work.archive('admin', objective._id)).toEqual({ ok: true })
    expect(await work.titles('bob')).toEqual([])
    expect(await work.titles('bob', 'archived')).toEqual(['Objective', 'Child'])
    expect(await work.setScope('alice', objective._id, 'personal')).toEqual({ ok: false, reason: 'archived' })
    await expect(work.update('alice', objective._id, { title: 'Edited' })).rejects.toThrow(/archived/)
    expect(await work.restore('alice', objective._id)).toEqual({ ok: true })
    expect(await work.titles('bob', 'workspace')).toEqual(['Objective', 'Child'])
    expect(await work.get('alice', child._id)).toMatchObject({ scope: 'workspace' })
    expect(await work.restore('alice', objective._id)).toEqual({ ok: false, reason: 'not_archived' })
  })

  test('a moved, archived and restored task writes to its log', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const task = await work.create('alice', { title: 'Logged' })
    await work.setScope('alice', task._id, 'workspace')
    await work.archive('alice', task._id)
    await work.restore('alice', task._id)
    const events = await work.events('alice', task._id)
    expect(events.map((e) => e.kind)).toEqual(['created', 'scope', 'archived', 'restored'])
    expect(events[1].data).toEqual({ from: 'personal', to: 'workspace' })
    expect(events.every((e) => e.actorPrincipalId === 'p-alice')).toBe(true)
  })
})

describe('deleting an archived task', () => {
  test('only an archived task, only by whoever may archive it; its subtree, log, and links go with it', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const objective = await work.create('alice', { title: 'Objective', scope: 'workspace' })
    const child = await work.create('alice', { title: 'Child', scope: 'workspace', parentId: objective._id })
    const bobsChild = await work.create('bob', { title: 'Bobs child', scope: 'workspace', parentId: objective._id })
    const other = await work.create('alice', { title: 'Other', scope: 'workspace' })
    await convex.run(async (ctx) => { await ctx.db.patch(other._id as never, { blockedBy: [objective._id, child._id] as never }) })
    await work.comment('alice', objective._id, 'note')

    expect(await work.remove('alice', objective._id)).toEqual({ ok: false, reason: 'not_archived' })
    expect(await work.archive('alice', objective._id)).toEqual({ ok: true })
    expect(await work.remove('bob', objective._id)).toEqual({ ok: false, reason: 'forbidden' })
    expect(await work.remove('gus', objective._id)).toEqual({ ok: false, reason: 'not_found' })
    expect(await work.remove('alice', objective._id)).toEqual({ ok: true })

    expect(await work.get('alice', objective._id)).toBeNull()
    expect(await work.get('alice', child._id)).toBeNull()
    // Bob's task was not archived with it, so it stays, now top level.
    expect(await work.get('bob', bobsChild._id)).toMatchObject({ title: 'Bobs child' })
    expect((await work.get('bob', bobsChild._id))?.parentId).toBeUndefined()
    // Links to deleted tasks are forgotten, and their log is gone.
    const kept = await convex.run(async (ctx) => await ctx.db.get(other._id as never)) as { blockedBy?: string[] }
    expect(kept.blockedBy).toEqual([])
    const leftovers = await convex.run(async (ctx) => await ctx.db.query('workItemEvents').collect())
    expect(leftovers.every((event) => event.workItemId !== objective._id)).toBe(true)
    expect(await work.remove('alice', objective._id)).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('structure', () => {
  test('a parent cannot be itself, a descendant, in another scope, archived, or too deep', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const objective = await work.create('alice', { title: 'Objective' })
    const task = await work.create('alice', { title: 'Task', parentId: objective._id })
    const sub = await work.create('alice', { title: 'Sub', parentId: task._id })

    await expect(work.update('alice', task._id, { parentId: task._id })).rejects.toThrow(/self/)
    await expect(work.update('alice', objective._id, { parentId: task._id })).rejects.toThrow(/descendant/)
    await expect(work.update('alice', objective._id, { parentId: sub._id })).rejects.toThrow(/descendant/)
    await expect(work.create('alice', { title: 'Too deep', parentId: sub._id })).rejects.toThrow(/too_deep/)

    const shared = await work.create('alice', { title: 'Shared', scope: 'workspace' })
    await expect(work.create('alice', { title: 'Cross', parentId: shared._id })).rejects.toThrow(/parent_scope/)
    await expect(work.create('bob', { title: 'Stranger', parentId: objective._id })).rejects.toThrow(/parent/)

    const lone = await work.create('alice', { title: 'Lone' })
    expect((await work.update('alice', lone._id, { parentId: task._id })).parentId).toBe(task._id)
    expect((await work.update('alice', lone._id, { parentId: null })).parentId).toBeUndefined()

    await work.archive('alice', objective._id)
    await expect(work.create('alice', { title: 'Late', parentId: objective._id })).rejects.toThrow(/parent/)
  })
})

describe('dependencies', () => {
  test('a task can wait on others; a task cannot wait on itself, and no chain of waiting may loop back', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const a = await work.create('alice', { title: 'A', scope: 'workspace' })
    const b = await work.create('alice', { title: 'B', scope: 'workspace' })
    const c = await work.create('alice', { title: 'C', scope: 'workspace' })

    expect(((await work.update('alice', b._id, { blockedBy: [a._id] })) as unknown as { blockedBy: string[] }).blockedBy).toEqual([a._id])
    await work.update('alice', c._id, { blockedBy: [b._id, a._id, b._id] })
    expect(((await work.get('alice', c._id)) as unknown as { blockedBy: string[] }).blockedBy).toEqual([b._id, a._id])

    await expect(work.update('alice', a._id, { blockedBy: [a._id] })).rejects.toThrow(/self/)
    await expect(work.update('alice', a._id, { blockedBy: [b._id] })).rejects.toThrow(/cycle/)
    // A longer chain: A would wait on C, which waits on B, which waits on A.
    await expect(work.update('alice', a._id, { blockedBy: [c._id] })).rejects.toThrow(/cycle/)
    // The refusals changed nothing.
    expect(((await work.get('alice', a._id)) as unknown as { blockedBy?: string[] }).blockedBy).toBeUndefined()

    // Waiting on fewer is always fine, and clearing works.
    await work.update('alice', c._id, { blockedBy: [b._id] })
    expect(((await work.get('alice', c._id)) as unknown as { blockedBy: string[] }).blockedBy).toEqual([b._id])
    await work.update('alice', c._id, { blockedBy: [] })
    expect(((await work.get('alice', c._id)) as unknown as { blockedBy: string[] }).blockedBy).toEqual([])
  })

  test('blockers must be active tasks the person can see, in the same scope; each change is logged with task titles', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const mine = await work.create('alice', { title: 'Mine' })
    const shared = await work.create('alice', { title: 'Shared', scope: 'workspace' })
    const bobsPrivate = await work.create('bob', { title: 'Bobs private' })
    const target = await work.create('alice', { title: 'Target', scope: 'workspace' })

    await expect(work.update('alice', target._id, { blockedBy: [mine._id] })).rejects.toThrow(/blocker/)
    await expect(work.update('alice', mine._id, { blockedBy: [shared._id] })).rejects.toThrow(/blocker/)
    await expect(work.update('alice', mine._id, { blockedBy: [bobsPrivate._id] })).rejects.toThrow(/blocker/)
    await expect(work.update('alice', target._id, { blockedBy: ['not-an-id'] })).rejects.toThrow(/blocker/)
    await work.archive('alice', shared._id)
    await expect(work.update('alice', target._id, { blockedBy: [shared._id] })).rejects.toThrow(/blocker/)

    const first = await work.create('alice', { title: 'First', scope: 'workspace' })
    const second = await work.create('alice', { title: 'Second', scope: 'workspace' })
    await work.update('alice', target._id, { blockedBy: [first._id] })
    await work.update('alice', target._id, { blockedBy: [second._id] })
    await work.update('alice', target._id, { blockedBy: [second._id] })
    const log = (await work.events('alice', target._id)).filter((event) => event.kind === 'dependencies')
    expect(log.map((event) => event.data)).toEqual([
      { added: ['First'], removed: [] },
      { added: ['Second'], removed: ['First'] },
    ])

    const many = await Promise.all(Array.from({ length: 51 }, (_, index) => work.create('alice', { title: `M${index}`, scope: 'workspace' })))
    await expect(work.update('alice', target._id, { blockedBy: many.map((task) => task._id) })).rejects.toThrow(/too_many/)
  })
})

describe('fields, assignees and validation', () => {
  test('title, dates, priority and brief fields are validated', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    await expect(work.create('alice', { title: '   ' })).rejects.toThrow(/title_required/)
    await expect(work.create('alice', { title: 'x'.repeat(201) })).rejects.toThrow(/title_too_long/)
    await expect(work.create('alice', { dueDate: '2026-02-30' })).rejects.toThrow(/date/)
    await expect(work.create('alice', { startDate: '2026-03-02', dueDate: '2026-03-01' })).rejects.toThrow(/date_order/)
    await expect(work.create('alice', { priority: 7 })).rejects.toThrow(/priority/)

    const task = await work.create('alice', { title: ' Trimmed ', startDate: '2026-03-01', dueDate: '2026-03-10', doneWhen: [{ text: ' Ship ', checked: false }, { text: '  ', checked: true }], context: [{ type: 'link', id: 'https://example.com', label: 'Spec' }] })
    expect(task).toMatchObject({ title: 'Trimmed', status: 'todo', priority: 2, blocked: false, startDate: '2026-03-01', dueDate: '2026-03-10' })
    expect((task as unknown as { doneWhen: unknown }).doneWhen).toEqual([{ text: 'Ship', checked: false }])

    await expect(work.update('alice', task._id, { dueDate: '2026-02-01' })).rejects.toThrow(/date_order/)
    const cleared = await work.update('alice', task._id, { startDate: null, dueDate: null, description: '# Hello' })
    expect(cleared.startDate).toBeUndefined()
    expect((cleared as unknown as { description: string }).description).toBe('# Hello')
    await expect(work.update('alice', task._id, { context: [{ type: 'link', id: '', label: 'x' }] })).rejects.toThrow(/context/)
  })

  test('agents are assignable according to visibility and creator, and unavailable agents are rejected', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    await addAgent(convex, { principalId: 'p-alice-agent', agentId: 'agent-alice', creatorPrincipalId: 'p-alice', visibility: 'creator' })
    await addAgent(convex, { principalId: 'p-bob-agent', agentId: 'agent-bob', creatorPrincipalId: 'p-bob', visibility: 'creator' })
    await addAgent(convex, { principalId: 'p-archived-agent', agentId: 'agent-archived', creatorPrincipalId: 'p-alice', visibility: 'workspace', archivedPrincipal: true })
    await addAgent(convex, { principalId: 'p-archived-definition', agentId: 'agent-archived-definition', creatorPrincipalId: 'p-alice', visibility: 'workspace', archivedDefinition: true })
    await addAgent(convex, { principalId: 'p-deleted-agent', agentId: 'agent-deleted', creatorPrincipalId: 'p-alice', visibility: 'workspace', deletedDefinition: true })
    const work = api(convex)
    const personalWithWorkspaceAgent = await work.create('alice', { title: 'Personal with workspace agent', assigneePrincipalId: 'p-agent' })
    expect(personalWithWorkspaceAgent.assigneePrincipalId).toBe('p-agent')
    const personalWithOwnAgent = await work.create('alice', { title: 'Personal with own agent', assigneePrincipalId: 'p-alice-agent' })
    expect(personalWithOwnAgent.assigneePrincipalId).toBe('p-alice-agent')
    await expect(work.create('alice', { title: 'Personal with another creator agent', assigneePrincipalId: 'p-bob-agent' })).rejects.toThrow(/personal_assignee/)

    const shared = await work.create('alice', { title: 'Shared', scope: 'workspace', assigneePrincipalId: 'p-bob' })
    expect(shared.assigneePrincipalId).toBe('p-bob')
    expect((await work.update('alice', shared._id, { assigneePrincipalId: 'p-agent' })).assigneePrincipalId).toBe('p-agent')
    await expect(work.update('alice', shared._id, { assigneePrincipalId: 'p-alice-agent' })).rejects.toThrow(/assignee/)
    await expect(work.update('alice', shared._id, { assigneePrincipalId: 'p-gus' })).rejects.toThrow(/assignee/)
    await expect(work.update('alice', shared._id, { assigneePrincipalId: 'p-outsider' })).rejects.toThrow(/assignee/)
    await expect(work.update('alice', shared._id, { assigneePrincipalId: 'nobody' })).rejects.toThrow(/assignee/)
    for (const principalId of ['p-archived-agent', 'p-archived-definition', 'p-deleted-agent']) {
      await expect(work.create('alice', { title: `Unavailable ${principalId}`, assigneePrincipalId: principalId })).rejects.toThrow(/assignee|personal_assignee/)
      await expect(work.update('alice', shared._id, { assigneePrincipalId: principalId })).rejects.toThrow(/assignee/)
    }
    expect((await work.update('alice', shared._id, { assigneePrincipalId: null })).assigneePrincipalId).toBeUndefined()

    const mine = await work.create('alice', { title: 'Mine' })
    await expect(work.update('alice', mine._id, { assigneePrincipalId: 'p-bob' })).rejects.toThrow(/personal_assignee/)
    expect((await work.update('alice', mine._id, { assigneePrincipalId: 'p-alice' })).assigneePrincipalId).toBe('p-alice')
    await expect(work.update('alice', shared._id, { reviewerUserId: 'gus' })).rejects.toThrow(/reviewer/)
    expect(await work.update('alice', shared._id, { reviewerUserId: 'owner' })).toMatchObject({ reviewerUserId: 'owner' })
  })

  test('the picker context lists people and visible agents only', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    await addAgent(convex, {
      principalId: 'p-alice-agent',
      agentId: 'agent-alice',
      creatorPrincipalId: 'p-alice',
      visibility: 'creator',
      avatarColor: '#b45309',
      avatarShape: 'hexagon',
    })
    await addAgent(convex, { principalId: 'p-bob-agent', agentId: 'agent-bob', creatorPrincipalId: 'p-bob', visibility: 'creator' })
    const ctxResult = await convex.query(q('work/workItems:context'), auth('alice')) as {
      principalId: string
      role: string
      canCreateInWorkspace: boolean
      assignees: Array<{ principalId: string; agentVisibility?: string; avatarColor?: string; avatarShape?: string }>
    }
    expect(ctxResult.principalId).toBe('p-alice')
    expect(ctxResult.canCreateInWorkspace).toBe(true)
    expect(ctxResult.assignees.map((a) => a.principalId)).toEqual(['p-admin', 'p-alice', 'p-bob', 'p-owner', 'p-alice-agent', 'p-agent'])
    expect(ctxResult.assignees.find((a) => a.principalId === 'p-agent')?.agentVisibility).toBe('workspace')
    expect(ctxResult.assignees.find((a) => a.principalId === 'p-alice-agent')?.agentVisibility).toBe('creator')
    expect(ctxResult.assignees.find((a) => a.principalId === 'p-alice-agent')).toMatchObject({
      avatarColor: '#b45309',
      avatarShape: 'hexagon',
    })
    expect(ctxResult.assignees.some((a) => a.principalId === 'p-bob-agent')).toBe(false)
    expect(await convex.query(q('work/workItems:context'), auth('gus'))).toBeNull()
    expect(await convex.query(q('work/workItems:context'), auth('outsider'))).toBeNull()
  })

  test('moving personal tasks to workspace clears creator-only agents and keeps workspace agents', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    await addAgent(convex, { principalId: 'p-alice-agent', agentId: 'agent-alice', creatorPrincipalId: 'p-alice', visibility: 'creator' })
    const work = api(convex)
    const creatorAgentTask = await work.create('alice', { title: 'Creator agent', assigneePrincipalId: 'p-alice-agent' })
    const workspaceAgentTask = await work.create('alice', { title: 'Workspace agent', assigneePrincipalId: 'p-agent' })
    await work.setScope('alice', creatorAgentTask._id, 'workspace')
    await work.setScope('alice', workspaceAgentTask._id, 'workspace')

    expect((await work.get('alice', creatorAgentTask._id))?.assigneePrincipalId).toBeUndefined()
    expect((await work.get('alice', workspaceAgentTask._id))?.assigneePrincipalId).toBe('p-agent')
    expect(await work.events('alice', creatorAgentTask._id)).toContainEqual(expect.objectContaining({
      kind: 'assignee', actorPrincipalId: 'p-alice', data: { from: 'p-alice-agent', to: null },
    }))
  })

  test('status changes, assignments and comments are logged with the actor', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const task = await work.create('alice', { title: 'Logged', scope: 'workspace' })
    await work.update('bob', task._id, { status: 'review', assigneePrincipalId: 'p-bob', blocked: true, priority: 3 })
    await work.comment('bob', task._id, ' Looks good ')
    await expect(work.comment('bob', task._id, '   ')).rejects.toThrow(/comment_required/)
    const events = await work.events('alice', task._id)
    expect(events.map((e) => e.kind).sort()).toEqual(['assignee', 'blocked', 'comment', 'created', 'priority', 'status'])
    expect(events.find((e) => e.kind === 'comment')).toMatchObject({ actorPrincipalId: 'p-bob', data: { body: 'Looks good' } })
    expect(events.find((e) => e.kind === 'status')?.data).toEqual({ from: 'todo', to: 'review' })
  })
})

describe('ordering', () => {
  test('new tasks go to the end of their column; move places a task between neighbours and changes status', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const a = await work.create('alice', { title: 'A' })
    const b = await work.create('alice', { title: 'B' })
    const c = await work.create('alice', { title: 'C' })
    expect(await work.titles('alice')).toEqual(['A', 'B', 'C'])

    await work.move('alice', c._id, { beforeId: a._id })
    expect(await work.titles('alice')).toEqual(['C', 'A', 'B'])
    await work.move('alice', c._id, { afterId: a._id, beforeId: b._id })
    expect(await work.titles('alice')).toEqual(['A', 'C', 'B'])
    await work.move('alice', a._id, { afterId: b._id })
    expect(await work.titles('alice')).toEqual(['C', 'B', 'A'])

    const moved = await work.move('alice', b._id, { status: 'done' })
    expect(moved.status).toBe('done')
    const doneColumn = (await work.list('alice')).filter((i) => i.status === 'done')
    expect(doneColumn.map((i) => i.title)).toEqual(['B'])
    // Updating the status from the list puts the task at the end of the new column.
    const d = await work.create('alice', { title: 'D' })
    await work.update('alice', d._id, { status: 'done' })
    expect((await work.list('alice')).filter((i) => i.status === 'done').map((i) => i.title)).toEqual(['B', 'D'])
  })

  test('a neighbour in another column or one the caller cannot see is ignored', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const mine = await work.create('alice', { title: 'Mine' })
    const bobs = await work.create('bob', { title: 'Bobs private' })
    const doneTask = await work.create('alice', { title: 'Done one', status: 'done' })
    const first = await work.create('alice', { title: 'First' })
    const result = await work.move('alice', mine._id, { beforeId: bobs._id, afterId: doneTask._id })
    expect(result.status).toBe('todo')
    expect((await work.list('alice')).filter((i) => i.status === 'todo').map((i) => i.title).slice(-1)).toEqual(['Mine'])
    expect(first.status).toBe('todo')
  })

  test('a column is rebalanced once ranks grow long, and the order survives', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const left = await work.create('alice', { title: 'Left' })
    const right = await work.create('alice', { title: 'Right' })
    const wedge = await work.create('alice', { title: 'Wedge' })
    // Wedge repeatedly into the gap right after Left, in a fresh item each time.
    const inserted: string[] = []
    for (let i = 0; i < 60; i += 1) {
      const item = await work.create('alice', { title: `W${i}` })
      await work.move('alice', item._id, { afterId: left._id, beforeId: inserted.length ? inserted[inserted.length - 1] : right._id })
      inserted.push(item._id)
    }
    const list = await work.list('alice')
    const titles = list.map((i) => i.title)
    expect(titles[0]).toBe('Left')
    expect(titles.slice(1, 61)).toEqual(Array.from({ length: 60 }, (_, i) => `W${59 - i}`))
    expect(titles.slice(61)).toEqual(['Right', 'Wedge'])
    expect(Math.max(...list.map((i) => i.rank.length))).toBeLessThan(24)
    expect(wedge.title).toBe('Wedge')
  })
})

type Linked = Item & { blockedBy?: string[]; reviewerUserId?: string }

describe('moving between Personal and Workspace keeps links valid', () => {
  test('an owner or reviewer who cannot read a Personal task is dropped when it moves there', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const task = await work.create('alice', { title: 'Handed over', scope: 'workspace', assigneePrincipalId: 'p-bob', reviewerUserId: 'bob' })
    expect(await work.setScope('alice', task._id, 'personal')).toEqual({ ok: true })
    const moved = (await work.get('alice', task._id)) as Linked
    expect(moved.scope).toBe('personal')
    expect(moved.assigneePrincipalId).toBeUndefined()
    expect(moved.reviewerUserId).toBeUndefined()
    const kinds = (await work.events('alice', task._id)).map((event) => event.kind)
    expect(kinds).toEqual(expect.arrayContaining(['assignee', 'reviewer', 'scope']))
    // Their own assignment survives.
    const own = await work.create('alice', { title: 'Mine', scope: 'workspace', assigneePrincipalId: 'p-alice' })
    await work.setScope('alice', own._id, 'personal')
    expect(((await work.get('alice', own._id)) as Linked).assigneePrincipalId).toBe('p-alice')
  })

  test('a task moved without its parent leaves it; a task moved with its parent keeps it; others\' children are released', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const parent = await work.create('alice', { title: 'Parent', scope: 'workspace' })
    const child = await work.create('alice', { title: 'Child', scope: 'workspace', parentId: parent._id })
    await work.setScope('alice', child._id, 'personal')
    expect(((await work.get('alice', child._id)) as Linked).parentId).toBeUndefined()

    const whole = await work.create('alice', { title: 'Whole', scope: 'workspace' })
    const inside = await work.create('alice', { title: 'Inside', scope: 'workspace', parentId: whole._id })
    const bobsChild = await work.create('bob', { title: 'Bobs child', scope: 'workspace', parentId: whole._id })
    await work.setScope('alice', whole._id, 'personal')
    expect(((await work.get('alice', inside._id)) as Linked).parentId).toBe(whole._id)
    expect(((await work.get('bob', bobsChild._id)) as Linked).parentId).toBeUndefined()
  })

  test('blockers in the other scope are released in both directions', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const first = await work.create('alice', { title: 'First', scope: 'workspace' })
    const waiting = await work.create('alice', { title: 'Waiting', scope: 'workspace' })
    await work.update('alice', waiting._id, { blockedBy: [first._id] })
    await work.setScope('alice', first._id, 'personal')
    expect(((await work.get('alice', waiting._id)) as Linked).blockedBy).toEqual([])

    const blocker = await work.create('alice', { title: 'Blocker', scope: 'workspace' })
    const other = await work.create('alice', { title: 'Other', scope: 'workspace' })
    await work.update('alice', other._id, { blockedBy: [blocker._id] })
    await work.setScope('alice', other._id, 'personal')
    expect(((await work.get('alice', other._id)) as Linked).blockedBy).toEqual([])
  })

  test('a private blocker\'s title never reaches the shared activity log', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const shared = await work.create('alice', { title: 'Shared', scope: 'workspace' })
    const secret = await work.create('alice', { title: 'Secret plan', scope: 'workspace' })
    await work.update('alice', shared._id, { blockedBy: [secret._id] })
    // A task from before the cleanup existed: still waiting on something that is now private.
    await convex.run(async (ctx) => { await ctx.db.patch(secret._id as never, { scope: 'personal' } as never) })
    await work.update('bob', shared._id, { blockedBy: [] })
    const log = (await work.events('bob', shared._id)).filter((event) => event.kind === 'dependencies')
    expect(log.at(-1)?.data).toEqual({ added: [], removed: ['a private task'] })
  })
})

describe('archived tasks and long ranks', () => {
  test('an archived task takes no comments', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const task = await work.create('alice', { title: 'Done and dusted', scope: 'workspace' })
    await work.comment('alice', task._id, 'before')
    await work.archive('alice', task._id)
    await expect(work.comment('alice', task._id, 'after')).rejects.toThrow(/archived/)
    const comments = (await work.events('alice', task._id)).filter((event) => event.kind === 'comment')
    expect(comments).toHaveLength(1)
  })

  test('adding a task to a column whose last rank has grown long renumbers the column first', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const a = await work.create('alice', { title: 'A', scope: 'workspace', status: 'todo' })
    const b = await work.create('alice', { title: 'B', scope: 'workspace', status: 'todo' })
    await convex.run(async (ctx) => {
      await ctx.db.patch(a._id as never, { rank: 'z'.repeat(30) } as never)
      await ctx.db.patch(b._id as never, { rank: `${'z'.repeat(30)}y` } as never)
    })
    const next = await work.create('alice', { title: 'Next', scope: 'workspace', status: 'todo' })
    const column = (await work.list('alice')).filter((item) => item.status === 'todo')
    expect(Math.max(...column.map((item) => item.rank.length))).toBeLessThan(24)
    expect(column.map((item) => item.title)).toEqual(['A', 'B', 'Next'])
    expect(next.rank).toBe(column.at(-1)?.rank)

    // The same goes for a task that changes column.
    const c = await work.create('alice', { title: 'C', scope: 'workspace', status: 'review' })
    await convex.run(async (ctx) => { await ctx.db.patch(c._id as never, { rank: 'z'.repeat(30) } as never) })
    const d = await work.create('alice', { title: 'D', scope: 'workspace', status: 'progress' })
    await work.update('alice', d._id, { status: 'review' })
    const review = (await work.list('alice')).filter((item) => item.status === 'review')
    expect(Math.max(...review.map((item) => item.rank.length))).toBeLessThan(24)
    expect(review.map((item) => item.title)).toEqual(['C', 'D'])
  })

  test('lists read only the view asked for', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const gone = await work.create('alice', { title: 'Gone', scope: 'workspace' })
    await work.create('alice', { title: 'Here', scope: 'workspace' })
    await work.create('alice', { title: 'Mine' })
    const mineArchived = await work.create('alice', { title: 'Old mine' })
    await work.archive('alice', gone._id)
    await work.archive('alice', mineArchived._id)
    expect(await work.titles('alice')).toEqual(['Here', 'Mine'])
    expect((await work.titles('alice', 'archived')).sort()).toEqual(['Gone', 'Old mine'])
    expect(await work.titles('bob', 'archived')).toEqual(['Gone'])
  })
})

describe('trusted callers, reviewers and batches', () => {
  test('a browser token alone reaches nothing: Work is served through the web app routes', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    const task = await work.create('alice', { title: 'Mine' })
    const noSecret = { workspaceId, userId: 'alice', accessToken: 'a-browser-token' }
    expect(await convex.query(q('work/workItems:list'), noSecret)).toEqual([])
    expect(await convex.query(q('work/workItems:get'), { ...noSecret, id: task._id })).toBeNull()
    await expect(convex.mutation(m('work/workItems:update'), { ...noSecret, id: task._id, title: 'x' })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(m('work/workItemEvents:addComment'), { ...noSecret, workItemId: task._id, body: 'x' })).rejects.toThrow(/Unauthorized/)
  })

  test('a named reviewer can approve or send back a task in review, and nothing else, even when members cannot edit', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex, { workspaceContentEditors: 'admins' })
    const work = api(convex)
    const task = await work.create('admin', { title: 'Ship it', scope: 'workspace', status: 'review', reviewerUserId: 'bob' })
    await expect(work.update('bob', task._id, { title: 'Renamed' })).rejects.toThrow(/Unauthorized/)
    await expect(work.update('bob', task._id, { status: 'done', priority: 3 })).rejects.toThrow(/Unauthorized/)
    await expect(work.update('bob', task._id, { status: 'todo' })).rejects.toThrow(/Unauthorized/)
    await expect(work.update('alice', task._id, { status: 'done' })).rejects.toThrow(/Unauthorized/)
    expect((await work.move('bob', task._id, { status: 'progress' })).status).toBe('progress')
    // Only while the task waits in review.
    await expect(work.update('bob', task._id, { status: 'done' })).rejects.toThrow(/Unauthorized/)
    await work.update('admin', task._id, { status: 'review' })
    expect((await work.update('bob', task._id, { status: 'done' })).status).toBe('done')
  })

  test('Personal tasks are not pushed out of the list by a long run of workspace tasks', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const work = api(convex)
    await work.create('alice', { title: 'Only mine' })
    await convex.run(async (ctx) => {
      for (let i = 0; i < 2_010; i += 1) {
        await ctx.db.insert('workItems', { scope: 'workspace', workspaceId, userId: 'alice', title: `W${i}`, status: 'todo', blocked: false, priority: 2, rank: 'M', createdAt: now + i, updatedAt: now + i })
      }
    })
    expect(await work.titles('alice', 'personal')).toEqual(['Only mine'])
    expect((await work.list('alice', 'workspace')).length).toBe(2_000)
  })
})
