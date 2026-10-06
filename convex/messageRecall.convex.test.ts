import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')
const secret = 'message-recall-secret'
const now = 1_900_000_000_000
const workspaceId = 'ws-recall'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const mutationRef = (name: string) => makeFunctionReference<'mutation'>(name)

type Convex = ReturnType<typeof convexTest>

/**
 * Alice's messages in four kinds of conversation, each with a chunk indexed the old way (shared with the workspace).
 * Bob is a teammate in the same workspace.
 */
async function seed(convex: Convex) {
  return await convex.run(async (ctx) => {
    const conversation = (conversationType: string | undefined, channelVisibility?: 'public' | 'private') => ctx.db.insert('conversations', {
      userId: 'alice', workspaceId, title: 't', lastModified: now, updatedAt: now, createdAt: now, lastMode: 'act', askModelIds: [], actModelId: 'm',
      ...(conversationType ? { conversationType: conversationType as 'personal' } : {}),
      ...(channelVisibility ? { channelVisibility } : {}),
    })
    const ids: Record<string, { chunkId: string; sourceId: string }> = {}
    for (const [label, type, vis] of [
      ['personal', 'personal', undefined],
      ['legacy', undefined, undefined],
      ['dm', 'dm', undefined],
      ['privateChannel', 'channel', 'private'],
      ['publicChannel', 'channel', 'public'],
    ] as const) {
      const conversationId = await conversation(type, vis as 'public' | 'private' | undefined)
      const messageId = await ctx.db.insert('conversationMessages', {
        conversationId, userId: 'alice', authorKind: 'human', authorPrincipalId: 'p-alice', turnId: `t-${label}`, role: 'user', mode: 'act',
        content: `${label} secret`, contentType: 'text', status: 'completed', createdAt: now, updatedAt: now,
      })
      const chunkId = await ctx.db.insert('knowledgeChunks', {
        userId: 'alice', workspaceId, sourceKind: 'message', sourceId: messageId, chunkIndex: 0, startOffset: 0, text: `${label} secret`,
        visibility: 'workspace', // how every message used to be indexed
      })
      ids[label] = { chunkId, sourceId: messageId }
    }
    return ids
  })
}

describe('who may recall a message', () => {
  test("the backfill takes personal chats, DMs, and private channels back from the workspace, and leaves a public channel shared", async () => {
    const convex = convexTest(schema, modules)
    const ids = await seed(convex)
    const run = (dryRun: boolean) => convex.mutation(mutationRef('knowledge/knowledge:backfillMessageChunkVisibilityByServer'), { serverSecret: secret, dryRun }) as Promise<{ scanned: number; wasShared: number; nowOwner: number; isDone: boolean }>
    const visibility = async () => convex.run(async (ctx) => Object.fromEntries(
      await Promise.all(Object.entries(ids).map(async ([label, { chunkId }]) => [label, (await ctx.db.get(chunkId as never) as { visibility?: string }).visibility])),
    ))

    const dry = await run(true)
    expect(dry).toMatchObject({ scanned: 5, wasShared: 4, nowOwner: 4, isDone: true })
    expect(Object.values(await visibility())).toEqual(['workspace', 'workspace', 'workspace', 'workspace', 'workspace'])

    await run(false)
    expect(await visibility()).toEqual({ personal: 'owner', legacy: 'owner', dm: 'owner', privateChannel: 'owner', publicChannel: 'workspace' })
    expect(await run(false)).toMatchObject({ wasShared: 0, nowOwner: 0 })
  })

  test('even before the backfill, a teammate recalls only public-channel messages; the author recalls their own', async () => {
    const convex = convexTest(schema, modules)
    const ids = await seed(convex)
    const chunks = Object.values(ids).map(({ chunkId, sourceId }) => ({ chunkId: chunkId as never, sourceId, userId: 'alice' }))
    const recallable = async (viewerUserId: string) => {
      const allowed = await convex.query(internal.knowledge.knowledge.recallableForeignMessageChunks, { viewerUserId, chunks }) as string[]
      return Object.entries(ids).filter(([, { chunkId }]) => allowed.includes(chunkId)).map(([label]) => label)
    }
    expect(await recallable('bob')).toEqual(['publicChannel'])
    expect(await recallable('someone-outside')).toEqual(['publicChannel'])
    // The author's own chunks never go through this check; it only answers for other people's.
  })

  test('a deleted message is never recalled', async () => {
    const convex = convexTest(schema, modules)
    const ids = await seed(convex)
    await convex.run(async (ctx) => { await ctx.db.patch(ids.publicChannel!.sourceId as never, { deletedAt: now }) })
    const allowed = await convex.query(internal.knowledge.knowledge.recallableForeignMessageChunks, {
      viewerUserId: 'bob', chunks: [{ chunkId: ids.publicChannel!.chunkId as never, sourceId: ids.publicChannel!.sourceId, userId: 'alice' }],
    })
    expect(allowed).toEqual([])
  })

  test('a message indexed now gets the right visibility from its conversation', async () => {
    const convex = convexTest(schema, modules)
    const ids = await seed(convex)
    const visibilityOf = async (label: string) => (await convex.query(internal.knowledge.knowledge.getMessageForReindex, { messageId: ids[label]!.sourceId as never }) as { visibility: string }).visibility
    expect(await visibilityOf('personal')).toBe('owner')
    expect(await visibilityOf('dm')).toBe('owner')
    expect(await visibilityOf('privateChannel')).toBe('owner')
    expect(await visibilityOf('publicChannel')).toBe('workspace')
  })
})
