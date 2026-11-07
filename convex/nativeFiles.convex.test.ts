import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const list = makeFunctionReference<'query'>('files/browse:list')
const get = makeFunctionReference<'query'>('files/browse:get')
const rename = makeFunctionReference<'mutation'>('files/browse:rename')
const move = makeFunctionReference<'mutation'>('files/browse:move')

type Row = { _id: string; name: string; parentId: string | null; r2Key?: unknown; storageId?: unknown; content?: unknown; previewText?: string }

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    for (const workspaceId of ['ws', 'other']) {
      await ctx.db.insert('workspaces', { workspaceId, kind: 'organization', name: workspaceId, slug: workspaceId, status: 'active', createdAt: 1, updatedAt: 1 })
    }
    const members: Array<[string, string, 'owner' | 'member']> = [['ws', 'alice', 'member'], ['ws', 'bob', 'member'], ['other', 'alice', 'owner']]
    for (const [workspaceId, userId, role] of members) {
      await ctx.db.insert('workspacePrincipals', { workspaceId, principalId: `p-${workspaceId}-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId, principalId: `p-${workspaceId}-${userId}`, membershipId: `m-${workspaceId}-${userId}`, role, status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    const file = (fields: Record<string, unknown>) => ctx.db.insert('files', {
      workspaceId: 'ws', userId: 'alice', type: 'file', kind: 'upload', createdAt: 1, updatedAt: 1, ...fields,
    } as never)
    return {
      folder: await file({ name: 'Plans', type: 'folder', kind: 'folder', updatedAt: 5 }),
      note: await file({ name: 'Ideas', kind: 'note', content: '# Ideas\nShip **it**', updatedAt: 4 }),
      blob: await file({ name: 'deck.pdf', r2Key: 'users/alice/files/x/deck.pdf', sizeBytes: 10, updatedAt: 3 }),
      shared: await file({ name: 'Team.md', scope: 'workspace', content: 'team', updatedAt: 2 }),
      archived: await file({ name: 'Old.md', archivedAt: 9, content: 'old' }),
      deleted: await file({ name: 'Gone.md', deletedAt: 9, content: 'gone' }),
      elsewhere: await file({ name: 'Other.md', workspaceId: 'other', content: 'other' }),
    }
  })
  const as = (subject: string) => t.withIdentity({ subject })
  return { t, as, ids }
}

const names = (rows: unknown) => (rows as Row[]).map(row => row.name)

test('the tree lists active files of the view, newest first, without text or storage keys', async () => {
  const { as } = await fixture()
  const rows = await as('alice').query(list, { workspaceId: 'ws' }) as Row[]
  expect(names(rows)).toEqual(['Plans', 'Ideas', 'deck.pdf', 'Team.md'])
  expect(names(await as('alice').query(list, { workspaceId: 'ws', view: 'personal' }))).toEqual(['Plans', 'Ideas', 'deck.pdf'])
  expect(names(await as('alice').query(list, { workspaceId: 'ws', view: 'workspace' }))).toEqual(['Team.md'])
  for (const row of rows) {
    expect(row.r2Key).toBeUndefined()
    expect(row.storageId).toBeUndefined()
    expect(row.content).toBeUndefined()
  }
  expect(rows.find(row => row.name === 'Ideas')?.previewText).toBe('Ideas\nShip it')
})

test('other members see only workspace-scoped files, and outsiders see nothing', async () => {
  const { t, as, ids } = await fixture()
  expect(names(await as('bob').query(list, { workspaceId: 'ws' }))).toEqual(['Team.md'])
  expect(await as('bob').query(get, { workspaceId: 'ws', fileId: ids.note })).toBeNull()
  expect((await as('bob').query(get, { workspaceId: 'ws', fileId: ids.shared }) as { content: string }).content).toBe('team')
  expect(await as('stranger').query(list, { workspaceId: 'ws' })).toBeNull()
  expect(await t.query(list, { workspaceId: 'ws' })).toBeNull()
  // A file read through the wrong workspace is not returned, even to its owner.
  expect(await as('alice').query(get, { workspaceId: 'ws', fileId: ids.elsewhere })).toBeNull()
  expect(await as('alice').query(get, { workspaceId: 'ws', fileId: ids.deleted })).toBeNull()
})

test('get returns the text and hides storage internals', async () => {
  const { as, ids } = await fixture()
  const blob = await as('alice').query(get, { workspaceId: 'ws', fileId: ids.blob }) as Row & { downloadUrl?: string }
  expect(blob.r2Key).toBeUndefined()
  expect(blob.downloadUrl).toBe(`/api/v1/files/${ids.blob}/content`)
})

test('rename and move reach every subscriber and respect edit rights and workspace bounds', async () => {
  const { as, ids, t } = await fixture()
  await as('alice').mutation(rename, { workspaceId: 'ws', fileId: ids.note, name: '  Roadmap  ' })
  await as('alice').mutation(move, { workspaceId: 'ws', fileId: ids.note, parentId: ids.folder })
  const note = await as('alice').query(get, { workspaceId: 'ws', fileId: ids.note }) as Row
  expect(note.name).toBe('Roadmap')
  expect(note.parentId).toBe(ids.folder)
  await as('alice').mutation(move, { workspaceId: 'ws', fileId: ids.note, parentId: null })
  expect((await as('alice').query(get, { workspaceId: 'ws', fileId: ids.note }) as Row).parentId).toBeNull()

  // Bob can read the workspace file but may not edit it; he cannot touch Alice's personal file at all.
  await expect(as('bob').mutation(rename, { workspaceId: 'ws', fileId: ids.shared, name: 'Mine' })).rejects.toThrow()
  await expect(as('bob').mutation(rename, { workspaceId: 'ws', fileId: ids.note, name: 'Mine' })).rejects.toThrow()
  await expect(as('stranger').mutation(rename, { workspaceId: 'ws', fileId: ids.note, name: 'Mine' })).rejects.toThrow('WORKSPACE_ACCESS_DENIED')
  // The workspace argument must match the file, and a folder from another workspace is not a valid parent.
  await expect(as('alice').mutation(rename, { workspaceId: 'other', fileId: ids.note, name: 'Mine' })).rejects.toThrow('Unauthorized')
  const foreignFolder = await t.run(ctx => ctx.db.insert('files', {
    workspaceId: 'other', userId: 'alice', name: 'Foreign', type: 'folder', kind: 'folder', createdAt: 1, updatedAt: 1,
  }))
  await expect(as('alice').mutation(move, { workspaceId: 'ws', fileId: ids.note, parentId: foreignFolder })).rejects.toThrow('Unauthorized')
  await expect(as('alice').mutation(rename, { workspaceId: 'ws', fileId: ids.note, name: '   ' })).rejects.toThrow('INVALID_NAME')
})

test("a thread's Library lists its files live for each reader", async () => {
  const { t, as } = await fixture()
  const forConversation = makeFunctionReference<'query'>('files/browse:forConversation')
  await t.run(async ctx => {
    const file = (fields: Record<string, unknown>) => ctx.db.insert('files', {
      workspaceId: 'ws', userId: 'alice', type: 'file', kind: 'output', conversationId: 'c1', createdAt: 1, updatedAt: 1, ...fields,
    } as never)
    await file({ name: 'chart.png', updatedAt: 3 })
    await file({ name: 'report.md', scope: 'workspace', updatedAt: 2 })
    await file({ name: 'elsewhere.md', conversationId: 'c2' })
    await file({ name: 'removed.png', deletedAt: 5 })
  })
  expect(names(await as('alice').query(forConversation, { workspaceId: 'ws', conversationId: 'c1' }))).toEqual(['chart.png', 'report.md'])
  expect(names(await as('bob').query(forConversation, { workspaceId: 'ws', conversationId: 'c1' }))).toEqual(['report.md'])
  expect(await as('stranger').query(forConversation, { workspaceId: 'ws', conversationId: 'c1' })).toBeNull()
  // Publishing a file reaches the subscription without any refetch.
  await t.run(ctx => ctx.db.insert('files', {
    workspaceId: 'ws', userId: 'alice', name: 'new.csv', type: 'file', kind: 'output', conversationId: 'c1', createdAt: 9, updatedAt: 9,
  }))
  expect(names(await as('alice').query(forConversation, { workspaceId: 'ws', conversationId: 'c1' }))[0]).toBe('new.csv')
})
