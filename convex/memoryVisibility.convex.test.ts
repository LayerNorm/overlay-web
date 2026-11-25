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

describe('moving agent memories to the place they were learned in', () => {
  const move = makeFunctionReference<'mutation'>('knowledge/knowledge:moveAgentMemoriesToTheirPlaceByServer')
  const defineAgent = (convex: Convex, agentId: string, extra: Record<string, unknown>) => convex.run(async (ctx) => {
    await ctx.db.insert('workspaceAgentDefinitions', {
      agentId, workspaceId: 'ws-1', principalId: `p-${agentId}`, name: agentId, instructions: '', harness: 'overlay',
      modelId: 'model', allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'p-alice',
      createdAt: 1, updatedAt: 1, ...extra,
    } as never)
  })
  /** A conversation with these active people in it; returns its id. */
  const room = (convex: Convex, people: string[], extra: Record<string, unknown> = {}) => convex.run(async (ctx) => {
    const id = await ctx.db.insert('conversations', {
      userId: people[0] ?? 'alice', workspaceId: 'ws-1', title: 'room', lastModified: 1, createdAt: 1, lastMode: 'act',
      askModelIds: [], actModelId: 'model', ...extra,
    } as never)
    for (const person of people) {
      await ctx.db.insert('conversationParticipants', {
        conversationId: id, workspaceId: 'ws-1', principalId: `p-${person}`, principalType: 'human', role: 'member',
        status: 'active', notificationLevel: 'all', joinedAt: 1, updatedAt: 1,
      })
    }
    return id as string
  })
  const savedIn = (convex: Convex, ownerId: string, content: string, conversationId?: string) =>
    convex.mutation(add, { serverSecret: secret, userId: ownerId, workspaceId: 'ws-1', content, source: 'chat', ...(conversationId ? { conversationId } : {}) })

  test('private places give memories to their person; workspace places keep them shared; running it again does nothing', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(async (ctx) => {
      for (const person of ['alice', 'bob']) {
        await ctx.db.insert('workspacePrincipals', {
          principalId: `p-${person}`, workspaceId: 'ws-1', type: 'human', userId: person, displayName: person, createdAt: 1, updatedAt: 1,
        } as never)
      }
    })
    await defineAgent(convex, 'personal', { agentRole: 'personal_chief', chiefOwnerUserId: 'alice', visibility: 'creator' })
    await defineAgent(convex, 'mine', { agentRole: 'agent', visibility: 'creator' })
    await defineAgent(convex, 'team', { agentRole: 'agent', visibility: 'workspace' })
    const bobAlone = await room(convex, ['bob'])
    const bothOfUs = await room(convex, ['alice', 'bob'])
    await savedIn(convex, agentMemoryOwnerId('personal'), 'Alice’s favorite fruit is durian')
    await savedIn(convex, agentMemoryOwnerId('mine'), 'Alice drafts on Sundays')
    await savedIn(convex, agentMemoryOwnerId('team'), 'Bob is interviewing elsewhere', bobAlone)
    await savedIn(convex, agentMemoryOwnerId('team'), 'Launch is on Friday', bothOfUs)
    await savedIn(convex, agentMemoryOwnerId('team'), 'Standup is at 10')
    expect(await recalledBy(convex, 'bob')).toHaveLength(5)
    // Every memory gets an indexed chunk with an embedding under its current owner.
    await convex.run(async (ctx) => {
      for (const memory of await ctx.db.query('memories').collect()) {
        const chunkId = await ctx.db.insert('knowledgeChunks', {
          userId: memory.userId, workspaceId: 'ws-1', sourceKind: 'memory', sourceId: memory._id, chunkIndex: 0, startOffset: 0, text: memory.content, visibility: memory.visibility ?? 'workspace',
        } as never)
        await ctx.db.insert('knowledgeChunkEmbeddings', { chunkId, userId: memory.userId, sourceKind: 'memory', embedding: [] })
      }
    })

    const dry = await convex.mutation(move, { serverSecret: secret, dryRun: true })
    expect(dry).toMatchObject({ memoriesMoved: 3, memoriesKept: 2 })
    expect(await recalledBy(convex, 'bob')).toHaveLength(5)

    expect(await convex.mutation(move, { serverSecret: secret, dryRun: false })).toMatchObject({ memoriesMoved: 3, isDone: true })
    expect(await recalledBy(convex, 'bob')).toEqual(['Bob is interviewing elsewhere', 'Launch is on Friday', 'Standup is at 10'])
    expect(await recalledBy(convex, 'alice')).toEqual(['Alice drafts on Sundays', 'Alice’s favorite fruit is durian', 'Launch is on Friday', 'Standup is at 10'])
    const chunks = await convex.run(async (ctx) => await ctx.db.query('knowledgeChunks').collect())
    const interviewing = chunks.filter((c) => c.text?.includes?.('interviewing'))
    expect(interviewing).toHaveLength(1)
    expect(interviewing[0]).toMatchObject({ userId: 'bob', visibility: 'owner' })
    const embedding = await convex.run(async (ctx) => await ctx.db.query('knowledgeChunkEmbeddings')
      .withIndex('by_chunkId', (q) => q.eq('chunkId', interviewing[0]!._id)).unique())
    expect(embedding?.userId).toBe('bob')
    expect((await convex.mutation(move, { serverSecret: secret, dryRun: false })).memoriesMoved).toBe(0)
  })
})

describe('moving a private memory to the workspace', () => {
  const moveToWorkspace = makeFunctionReference<'mutation'>('knowledge/memories:moveToWorkspace')

  test('its owner can share it, and nothing makes it private again', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(async (ctx) => {
      await ctx.db.insert('workspaces', { workspaceId: 'ws-1', kind: 'organization', name: 'Team', slug: 'team', status: 'active', createdAt: 1, updatedAt: 1 } as never)
      for (const person of ['alice', 'bob']) {
        await ctx.db.insert('workspacePrincipals', { principalId: `p-${person}`, workspaceId: 'ws-1', type: 'human', userId: person, displayName: person, createdAt: 1, updatedAt: 1 } as never)
        await ctx.db.insert('workspaceMemberships', { membershipId: `m-${person}`, workspaceId: 'ws-1', principalId: `p-${person}`, role: 'member', status: 'active', joinedAt: 1, updatedAt: 1 })
      }
    })
    const memoryId = await save(convex, 'alice', 'The team standup is at 10')
    await convex.run(async (ctx) => {
      await ctx.db.insert('knowledgeChunks', {
        userId: 'alice', workspaceId: 'ws-1', sourceKind: 'memory', sourceId: memoryId, chunkIndex: 0, startOffset: 0, text: 'The team standup is at 10', visibility: 'owner',
      } as never)
    })
    expect(await recalledBy(convex, 'bob')).toEqual([])
    await expect(convex.withIdentity({ subject: 'bob' }).mutation(moveToWorkspace, { workspaceId: 'ws-1', memoryId })).rejects.toThrow()
    await expect(convex.mutation(moveToWorkspace, { workspaceId: 'ws-1', memoryId })).rejects.toThrow()
    await convex.withIdentity({ subject: 'alice' }).mutation(moveToWorkspace, { workspaceId: 'ws-1', memoryId })
    expect(await recalledBy(convex, 'bob')).toEqual(['The team standup is at 10'])
    // Its search chunks are shared too, without waiting for a re-index that would skip unchanged text.
    const chunks = await convex.run(async (ctx) => await ctx.db.query('knowledgeChunks').collect())
    expect(chunks.filter((chunk) => chunk.sourceId === memoryId).map((chunk) => chunk.visibility)).toEqual(['workspace'])
    const update = makeFunctionReference<'mutation'>('knowledge/memories:update')
    await expect(convex.mutation(update, {
      serverSecret: secret, userId: 'alice', workspaceId: 'ws-1', memoryId, content: 'The team standup is at 10', visibility: 'owner',
    })).rejects.toThrow()
  })
})

describe('where an agent’s memory belongs', () => {
  test('a workspace automation’s thread is a workspace context; a personal one’s is not (P6)', async () => {
    const { conversationIsWorkspaceContext } = await import('./harness/runs')
    const convex = convexTest(schema, modules)
    const result = await convex.run(async (ctx) => {
      const thread = (scope?: 'workspace' | 'personal') => ctx.db.insert('conversations', {
        userId: 'alice', workspaceId: 'ws-1', title: 'automation', lastModified: 1, createdAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'model',
      } as never).then(async (conversationId) => {
        await ctx.db.insert('automations', {
          userId: 'alice', workspaceId: 'ws-1', name: 'a', instructions: 'x', enabled: true, conversationId, createdAt: 1, updatedAt: 1,
          ...(scope ? { scope } : {}),
        } as never)
        return conversationId
      })
      const check = (conversationId: string) => conversationIsWorkspaceContext(ctx as never, {
        workspaceId: 'ws-1', actorUserId: 'alice', conversationId, serverSecret: secret,
      })
      const archivedFromWorkspace = await ctx.db.insert('conversations', {
        userId: 'alice', workspaceId: 'ws-1', title: 'automation', lastModified: 1, createdAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'model',
      } as never)
      await ctx.db.insert('automations', {
        userId: 'alice', workspaceId: 'ws-1', name: 'a', instructions: 'x', enabled: false, conversationId: archivedFromWorkspace,
        createdAt: 1, updatedAt: 1, archivedAt: 2, archivedFromScope: 'workspace',
      } as never)
      const deletedWorkspace = await ctx.db.insert('conversations', {
        userId: 'alice', workspaceId: 'ws-1', title: 'automation', lastModified: 1, createdAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'model',
      } as never)
      await ctx.db.insert('automations', {
        userId: 'alice', workspaceId: 'ws-1', name: 'a', instructions: 'x', enabled: false, conversationId: deletedWorkspace,
        createdAt: 1, updatedAt: 1, scope: 'workspace', deletedAt: 3,
      } as never)
      return {
        workspace: await check(await thread('workspace')), personal: await check(await thread('personal')), unscoped: await check(await thread()),
        archivedFromWorkspace: await check(archivedFromWorkspace), deletedWorkspace: await check(deletedWorkspace),
      }
    })
    expect(result).toEqual({ workspace: true, personal: false, unscoped: false, archivedFromWorkspace: true, deletedWorkspace: false })
  })
})
