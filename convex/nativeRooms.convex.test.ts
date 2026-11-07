import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const access = makeFunctionReference<'query'>('collaboration/rooms:access')
const messages = makeFunctionReference<'query'>('collaboration/rooms:messages')
const message = makeFunctionReference<'query'>('collaboration/rooms:message')
const edit = makeFunctionReference<'mutation'>('collaboration/rooms:editMessage')
const remove = makeFunctionReference<'mutation'>('collaboration/rooms:deleteMessage')
const compatibility = makeFunctionReference<'query'>('collaboration/rooms:compatibility')
const page = (numItems: number, cursor: string | null = null) => ({ numItems, cursor })

type Row = { id: string; content: string; threadRootMessageId?: string; deletedAt?: number }
type Page = { page: Row[]; isDone: boolean; continueCursor: string }

async function fixture() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'ws', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 })
    for (const userId of ['alice', 'bob', 'carol']) {
      await ctx.db.insert('workspacePrincipals', { workspaceId: 'ws', principalId: `p-${userId}`, userId, type: 'human', displayName: userId, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('workspaceMemberships', { workspaceId: 'ws', principalId: `p-${userId}`, membershipId: `m-${userId}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
    }
    const channel = await ctx.db.insert('conversations', {
      workspaceId: 'ws', userId: 'alice', title: 'general', conversationType: 'channel', scope: 'workspace',
      askModelIds: ['model'], actModelId: 'model', lastMode: 'act', createdAt: 1, lastModified: 1,
    } as never)
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('conversationParticipants', {
        conversationId: channel, workspaceId: 'ws', principalId: `p-${userId}`, principalType: 'human',
        role: 'member', status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1,
      })
    }
    const insert = (content: string, createdAt: number, authorPrincipalId: string, threadRootMessageId?: unknown) => ctx.db.insert('conversationMessages', {
      conversationId: channel, userId: 'alice', turnId: `turn-${createdAt}`, role: 'user', mode: 'act', contentType: 'text',
      content, parts: [{ type: 'text', text: content }], authorKind: 'human', authorPrincipalId, createdAt,
      ...(threadRootMessageId ? { threadRootMessageId } : {}),
    } as never)
    const root = await insert('old root', 1, 'p-alice')
    await insert('old reply', 2, 'p-bob', root)
    // Push the root and its reply far behind the newest rows.
    for (let index = 0; index < 520; index += 1) await insert(`filler ${index}`, 10 + index, 'p-bob')
    const mine = await insert('alice latest', 1000, 'p-alice')
    return { channel, root, mine }
  })
  return { t, ids, as: (subject: string) => t.withIdentity({ subject }) }
}

test('participants page the full main timeline, and old threads stay reachable', async () => {
  const { as, ids } = await fixture()
  const args = { workspaceId: 'ws', conversationId: ids.channel }
  expect(await as('alice').query(access, args)).toEqual({ title: 'general', conversationType: 'channel', externalPlatform: null })
  const first = await as('alice').query(messages, { ...args, paginationOpts: page(50) }) as Page
  expect(first.page[0]?.content).toBe('alice latest')
  expect(first.page.every(row => !row.threadRootMessageId)).toBe(true)
  let cursor: string | null = first.continueCursor
  let all = first.page
  while (cursor) {
    const next = await as('alice').query(messages, { ...args, paginationOpts: page(100, cursor) }) as Page
    all = [...all, ...next.page]
    cursor = next.isDone ? null : next.continueCursor
  }
  expect(all.map(row => row.content)).toContain('old root')
  expect(all.map(row => row.content)).not.toContain('old reply')
  const thread = await as('bob').query(messages, { ...args, threadRootMessageId: ids.root, paginationOpts: page(20) }) as Page
  expect(thread.page.map(row => row.content)).toEqual(['old reply'])
  expect((await as('bob').query(message, { ...args, messageId: ids.root }) as Row).content).toBe('old root')
})

test('a workspace member who is not a participant reads nothing', async () => {
  const { as, t, ids } = await fixture()
  const args = { workspaceId: 'ws', conversationId: ids.channel }
  expect(await as('carol').query(access, args)).toBeNull()
  expect(((await as('carol').query(messages, { ...args, paginationOpts: page(10) })) as Page).page).toEqual([])
  expect(await as('carol').query(message, { ...args, messageId: ids.mine })).toBeNull()
  expect(await t.query(access, args)).toBeNull()
  await expect(as('carol').mutation(remove, { ...args, messageId: ids.mine })).rejects.toThrow('CONVERSATION_ACCESS_DENIED')
})

test('only the author edits or deletes a message, and both change it in place', async () => {
  const { as, ids } = await fixture()
  const args = { workspaceId: 'ws', conversationId: ids.channel, messageId: ids.mine }
  expect(await as('bob').mutation(edit, { ...args, content: 'hijack' })).toBe(false)
  expect(await as('alice').mutation(edit, { ...args, content: 'edited' })).toBe(true)
  const edited = await as('bob').query(message, args) as Row & { editHistory?: unknown[] }
  expect(edited.content).toBe('edited')
  expect(edited.editHistory).toHaveLength(1)
  expect(await as('bob').mutation(remove, args)).toBe(false)
  expect(await as('alice').mutation(remove, args)).toBe(true)
  expect((await as('bob').query(message, args) as Row).deletedAt).toBeTypeOf('number')
})

test('room writability is readable live by participants only', async () => {
  const { as, ids } = await fixture()
  const args = { workspaceId: 'ws', conversationId: ids.channel }
  expect(await as('alice').query(compatibility, args)).toEqual({ compatibility: { readOnly: false }, agentId: null })
  expect(await as('alice').query(compatibility, { ...args, threadRootMessageId: ids.root })).toEqual({ compatibility: { readOnly: false }, agentId: null })
  expect(await as('carol').query(compatibility, args)).toBeNull()
})
