import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { agentMemoryOwnerId } from '../src/shared/agents/agent-memory'

const modules = import.meta.glob('./**/*.ts')
const secret = 'tool-scoping-secret'
const now = 1_900_000_000_000
const workspaceId = 'ws-tools'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const q = (name: string) => makeFunctionReference<'query'>(name)
const m = (name: string) => makeFunctionReference<'mutation'>(name)
type Convex = ReturnType<typeof convexTest>

async function seed(convex: Convex) {
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', { workspaceId, kind: 'organization', name: 'Tools', slug: 'tools', status: 'active', createdAt: now, updatedAt: now })
    for (const [userId, name] of [['alice', 'Alice'], ['bob', 'Bob']] as const) {
      await ctx.db.insert('workspacePrincipals', { principalId: `p-${userId}`, workspaceId, type: 'human', userId, displayName: name, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { membershipId: `m-${userId}`, workspaceId, principalId: `p-${userId}`, role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    }
  })
}

const auth = { serverSecret: secret, workspaceId }

describe('agent tools in a workspace context', () => {
  test('archive and restore refuse Personal items and moves are refused outright', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const create = (name: string, scope?: 'workspace') =>
      convex.mutation(m('integrations/skills:create'), { ...auth, userId: 'alice', name, description: 'd', instructions: 'i', ...(scope ? { scope } : {}) }) as Promise<string>
    const mine = await create('Mine')
    const ours = await create('Ours', 'workspace')
    const inRoom = { ...auth, userId: 'alice', workspaceItemsOnly: true }

    expect(await convex.mutation(m('integrations/skills:archive'), { ...inRoom, id: mine })).toEqual({ ok: false, reason: 'workspace_items_only' })
    expect(await convex.mutation(m('integrations/skills:setScope'), { ...inRoom, id: mine, to: 'workspace' })).toEqual({ ok: false, reason: 'workspace_items_only' })
    expect(await convex.mutation(m('integrations/skills:archive'), { ...inRoom, id: ours })).toEqual({ ok: true })
    expect(await convex.mutation(m('integrations/skills:restore'), { ...inRoom, id: ours })).toEqual({ ok: true })

    // Outside a workspace context the same person archives their own Personal item and restores it.
    expect(await convex.mutation(m('integrations/skills:archive'), { ...auth, userId: 'alice', id: mine })).toEqual({ ok: true })
    expect(await convex.mutation(m('integrations/skills:restore'), { ...inRoom, id: mine })).toEqual({ ok: false, reason: 'workspace_items_only' })
    expect(await convex.mutation(m('integrations/skills:restore'), { ...auth, userId: 'alice', id: mine })).toEqual({ ok: true })
  })

  test('archiving a folder leaves the contents the caller could not archive on their own', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const ids = await convex.run(async (ctx) => {
      const bob = await ctx.db.query('workspaceMemberships').filter((q) => q.eq(q.field('principalId'), 'p-bob')).first()
      await ctx.db.patch(bob!._id, { role: 'admin' })
      const file = (name: string, scope: 'personal' | 'workspace', parentId?: string, type: 'file' | 'folder' = 'file') =>
        ctx.db.insert('files', { userId: 'alice', workspaceId, name, type, scope, createdAt: now, updatedAt: now, ...(parentId ? { parentId } : {}) })
      const folder = await file('Launch', 'workspace', undefined, 'folder')
      const shared = await file('Plan', 'workspace', folder)
      const personal = await file('Diary', 'personal', folder)
      return { folder, shared, personal }
    })
    const archivedAt = (id: string) => convex.run(async (ctx) => (await ctx.db.get(id as never) as { archivedAt?: number } | null)?.archivedAt ?? null)

    // From a room, Alice's own folder archives with its Workspace contents only.
    expect(await convex.mutation(m('files/files:archive'), { ...auth, userId: 'alice', workspaceItemsOnly: true, id: ids.folder })).toEqual({ ok: true })
    expect(await archivedAt(ids.shared)).not.toBeNull()
    expect(await archivedAt(ids.personal)).toBeNull()
    expect(await convex.mutation(m('files/files:restore'), { ...auth, userId: 'alice', workspaceItemsOnly: true, id: ids.folder })).toEqual({ ok: true })

    // An admin archiving the Workspace folder does not archive Alice's Personal file inside it.
    expect(await convex.mutation(m('files/files:archive'), { ...auth, userId: 'bob', id: ids.folder })).toEqual({ ok: true })
    expect(await archivedAt(ids.shared)).not.toBeNull()
    expect(await archivedAt(ids.personal)).toBeNull()
  })

  test('a teammate can open a Workspace file’s content, not a Personal one', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const ids = await convex.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(['png']))
      const output = (name: string, scope: 'personal' | 'workspace') =>
        ctx.db.insert('files', { userId: 'alice', workspaceId, name, type: 'file', kind: 'output', scope, storageId, createdAt: now, updatedAt: now })
      return { shared: await output('cat.png', 'workspace'), personal: await output('dog.png', 'personal') }
    })
    const open = (userId: string, fileId: string) =>
      convex.query(q('files/files:getStorageUrlForProxy'), { serverSecret: secret, userId, fileId })
    expect(await open('bob', ids.shared)).toMatchObject({ name: 'cat.png' })
    expect(await open('bob', ids.personal)).toBeNull()
    expect(await open('alice', ids.personal)).toMatchObject({ name: 'dog.png' })
  })

  test('an archived automation cannot be turned on; restoring it first is the way back', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const automationId = await convex.run((ctx) => ctx.db.insert('automations', {
      userId: 'alice', workspaceId, name: 'Morning Digest', description: '', instructions: 'Summarize', enabled: false,
      timezone: 'UTC', scope: 'workspace', archivedAt: now, archivedBy: 'alice', archivedFromScope: 'workspace', createdAt: now, updatedAt: now,
    } as never))
    await expect(convex.mutation(m('automations/automations:update'), { ...auth, userId: 'alice', automationId, enabled: true }))
      .rejects.toThrow(/AUTOMATION_ARCHIVED/)
    // Other edits to an archived automation, such as its name, still save.
    await convex.mutation(m('automations/automations:update'), { ...auth, userId: 'alice', automationId, name: 'Evening Digest' })
    expect(await convex.run(async (ctx) => (await ctx.db.get(automationId as never) as { name: string; enabled: boolean } | null)))
      .toMatchObject({ name: 'Evening Digest', enabled: false })
  })

  test('owner names are given only to a member, only for this workspace’s people', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const names = (userId: string, userIds: string[]) =>
      convex.query(q('collaboration/directory:memberNamesByServer'), { ...auth, userId, userIds })
    expect(await names('alice', ['bob', 'stranger'])).toEqual({ bob: 'Bob' })
    expect(await names('stranger', ['bob'])).toEqual({})
  })
})

describe('one-time moves', () => {
  test('a person’s unmarked memories become theirs, with their chunks; agents’ and marked memories are left', async () => {
    const convex = convexTest(schema, modules)
    const ids = await convex.run(async (ctx) => {
      const memory = (userId: string, visibility?: 'owner' | 'workspace') =>
        ctx.db.insert('memories', { workspaceId, userId, content: 'c', source: 'chat', createdAt: now, ...(visibility ? { visibility } : {}) })
      const person = await memory('alice')
      const agent = await memory(agentMemoryOwnerId('agent_1'))
      const shared = await memory('bob', 'workspace')
      await ctx.db.insert('knowledgeChunks', { userId: 'alice', workspaceId, sourceKind: 'memory', sourceId: person, chunkIndex: 0, startOffset: 0, text: 'c' })
      return { person, agent, shared }
    })
    const run = (dryRun: boolean) => convex.mutation(m('migrations/personalMemoryVisibility:makePersonalMemoriesPrivateByServer'), { serverSecret: secret, dryRun })
    expect(await run(true)).toMatchObject({ memories: 1, chunks: 1, isDone: true })
    expect(await run(false)).toMatchObject({ memories: 1, chunks: 1 })
    expect(await run(false)).toMatchObject({ memories: 0, chunks: 0 })
    await convex.run(async (ctx) => {
      expect((await ctx.db.get(ids.person))?.visibility).toBe('owner')
      expect((await ctx.db.get(ids.agent))?.visibility).toBeUndefined()
      expect((await ctx.db.get(ids.shared))?.visibility).toBe('workspace')
      const chunk = await ctx.db.query('knowledgeChunks').first()
      expect(chunk?.visibility).toBe('owner')
    })
  })

  test('generated outputs get the workspace of the chat they were made in', async () => {
    const convex = convexTest(schema, modules)
    const ids = await convex.run(async (ctx) => {
      const conversationId = await ctx.db.insert('conversations', { userId: 'alice', workspaceId, title: 't', lastModified: now, createdAt: now, lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free' })
      const output = (conversation?: string) => ctx.db.insert('files', {
        userId: 'alice', name: 'o.png', type: 'file', kind: 'output', content: '', createdAt: now, updatedAt: now,
        ...(conversation ? { conversationId: conversation } : {}),
      })
      return { inChat: await output(conversationId), orphan: await output() }
    })
    const run = (dryRun: boolean) => convex.mutation(m('migrations/outputWorkspaces:backfillOutputWorkspacesByServer'), { serverSecret: secret, dryRun })
    expect(await run(true)).toMatchObject({ fixed: 1, unresolved: 1 })
    expect(await run(false)).toMatchObject({ fixed: 1, unresolved: 1 })
    expect(await run(false)).toMatchObject({ fixed: 0, unresolved: 1 })
    await convex.run(async (ctx) => {
      expect((await ctx.db.get(ids.inChat))?.workspaceId).toBe(workspaceId)
      expect((await ctx.db.get(ids.orphan))?.workspaceId).toBeUndefined()
    })
  })
})
