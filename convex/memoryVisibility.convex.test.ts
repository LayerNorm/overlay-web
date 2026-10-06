import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { agentMemoryOwnerId } from '../src/shared/agents/agent-memory'

const modules = import.meta.glob('./**/*.ts')
const secret = 'memory-visibility-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

type Convex = ReturnType<typeof convexTest>
const add = makeFunctionReference<'mutation'>('knowledge/memories:add')
const listWorkspace = makeFunctionReference<'query'>('knowledge/memories:listWorkspace')

const save = (convex: Convex, userId: string, content: string, visibility?: 'owner' | 'workspace') =>
  convex.mutation(add, { serverSecret: secret, userId, workspaceId: 'ws-1', content, source: 'chat', ...(visibility ? { visibility } : {}) })
const recalledBy = async (convex: Convex, viewerUserId: string) =>
  (await convex.query(listWorkspace, { serverSecret: secret, workspaceId: 'ws-1', viewerUserId })).map((memory: { content: string }) => memory.content).sort()

describe('who a new memory is for', () => {
  test('a person’s memory saved with no choice is theirs: a teammate does not recall it', async () => {
    const convex = convexTest(schema, modules)
    await save(convex, 'alice', 'Alice is vegetarian')
    expect(await recalledBy(convex, 'alice')).toEqual(['Alice is vegetarian'])
    expect(await recalledBy(convex, 'bob')).toEqual([])
    const row = await convex.run(async (ctx) => await ctx.db.query('memories').first())
    expect(row?.visibility).toBe('owner')
  })

  test('saving it as shared still shares it with the workspace', async () => {
    const convex = convexTest(schema, modules)
    await save(convex, 'alice', 'The team standup is at 10', 'workspace')
    expect(await recalledBy(convex, 'bob')).toEqual(['The team standup is at 10'])
  })

  test('an agent’s memory is workspace knowledge and stays shared', async () => {
    const convex = convexTest(schema, modules)
    await save(convex, agentMemoryOwnerId('agent-1'), 'Customers ask about pricing first')
    expect(await recalledBy(convex, 'bob')).toEqual(['Customers ask about pricing first'])
  })

  test('asked with no viewer (what an agent in a shared room gets), even the saver’s own private memory is left out', async () => {
    const convex = convexTest(schema, modules)
    await save(convex, 'alice', 'Alice is vegetarian')
    await save(convex, 'alice', 'The team standup is at 10', 'workspace')
    const noViewer = (await convex.query(listWorkspace, { serverSecret: secret, workspaceId: 'ws-1' })).map((memory: { content: string }) => memory.content)
    expect(noViewer).toEqual(['The team standup is at 10'])
  })

  test('memories from before the rule (no value stored) still read as shared', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(async (ctx) => {
      await ctx.db.insert('memories', { userId: 'alice', workspaceId: 'ws-1', content: 'Old shared one', source: 'chat', createdAt: 1, updatedAt: 1 })
    })
    expect(await recalledBy(convex, 'bob')).toEqual(['Old shared one'])
  })
})

describe('backfilling memories from before the rule', () => {
  const backfill = makeFunctionReference<'mutation'>('knowledge/knowledge:backfillMemoryVisibilityByServer')

  /** Alice's two old memories (shared by default), an agent's, and one Alice shared on purpose; each with an indexed chunk. */
  async function seedOld(convex: Convex) {
    await convex.run(async (ctx) => {
      const old = (userId: string, content: string, visibility?: 'owner' | 'workspace') => ctx.db.insert('memories', {
        userId, workspaceId: 'ws-1', content, source: 'chat', createdAt: 1, updatedAt: 1, ...(visibility ? { visibility } : {}),
      })
      for (const [userId, content, visibility] of [
        ['alice', 'Alice is vegetarian', undefined],
        ['alice', 'Alice lives in Lisbon', undefined],
        [agentMemoryOwnerId('agent-1'), 'Customers ask about pricing first', undefined],
        ['alice', 'The team standup is at 10', 'workspace' as const],
      ] as const) {
        const id = await old(userId, content, visibility)
        await ctx.db.insert('knowledgeChunks', {
          userId, workspaceId: 'ws-1', sourceKind: 'memory', sourceId: id, chunkIndex: 0, startOffset: 0, text: content, visibility: visibility ?? 'workspace',
        })
      }
    })
  }
  const chunkVisibility = (convex: Convex) => convex.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query('knowledgeChunks').collect()).map((chunk) => [chunk.text, chunk.visibility])))

  test('a dry run counts and changes nothing', async () => {
    const convex = convexTest(schema, modules)
    await seedOld(convex)
    const result = await convex.mutation(backfill, { serverSecret: secret, dryRun: true })
    expect(result).toMatchObject({ scanned: 4, madePrivate: 2, chunksMadePrivate: 2, agentOwnedKept: 1, alreadyChosen: 1, isDone: true })
    expect(await recalledBy(convex, 'bob')).toHaveLength(4)
  })

  test('people’s old memories become private with their chunks; an agent’s and a deliberately shared one stay shared; running it again does nothing', async () => {
    const convex = convexTest(schema, modules)
    await seedOld(convex)
    await convex.mutation(backfill, { serverSecret: secret, dryRun: false })
    expect(await recalledBy(convex, 'bob')).toEqual(['Customers ask about pricing first', 'The team standup is at 10'])
    expect(await recalledBy(convex, 'alice')).toHaveLength(4)
    expect(await chunkVisibility(convex)).toEqual({
      'Alice is vegetarian': 'owner', 'Alice lives in Lisbon': 'owner',
      'Customers ask about pricing first': 'workspace', 'The team standup is at 10': 'workspace',
    })
    expect(await convex.mutation(backfill, { serverSecret: secret, dryRun: false })).toMatchObject({ madePrivate: 0, chunksMadePrivate: 0 })
  })
})
