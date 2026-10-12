import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-thread-archive-secret'
const now = 1_900_000_000_000
const workspaceId = 'workspace-threads'
const userId = 'user-1'
const humanPrincipal = 'principal-human-1'
const agentPrincipal = 'principal-agent-1'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const threads = (name: string, type: 'mutation' | 'query') => makeFunctionReference<typeof type>(`agents/agentThreads:${name}`)
const agentsFn = (name: string, type: 'mutation' | 'query') => makeFunctionReference<typeof type>(`collaboration/agents:${name}`)

async function seed() {
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    for (const [principalId, type, extra] of [
      [humanPrincipal, 'human', { userId }],
      [agentPrincipal, 'agent', { agentId: 'agent-1' }],
    ] as const) {
      await ctx.db.insert('workspacePrincipals', { principalId, workspaceId, type, displayName: principalId, createdAt: now, updatedAt: now, ...extra })
      await ctx.db.insert('workspaceMemberships', {
        membershipId: `m-${principalId}`, workspaceId, principalId, role: 'member', status: 'active', joinedAt: now, updatedAt: now,
      })
    }
    await ctx.db.insert('workspaceAgentDefinitions', {
      agentId: 'agent-1', workspaceId, principalId: agentPrincipal, name: 'Researcher', instructions: 'x', harness: 'overlay',
      modelId: 'm', allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: humanPrincipal, createdAt: now, updatedAt: now,
    })
  })
  const base = { serverSecret: secret, workspaceId, agentId: 'agent-1', userId }
  const resolveMain = () => convex.mutation(threads('resolveMainThreadByServer', 'mutation'), base) as Promise<{ conversationId: string; title: string }>
  const createThread = (title: string) => convex.mutation(threads('createThreadByServer', 'mutation'), { ...base, title }) as Promise<{ conversationId: string }>
  const setArchived = (conversationId: string, archived: boolean) => convex.mutation(threads('setThreadArchivedByServer', 'mutation'), { serverSecret: secret, conversationId, agentId: 'agent-1', userId, archived } as never)
  const deleteThread = (conversationId: string) => convex.mutation(threads('deleteThreadByServer', 'mutation'), { serverSecret: secret, conversationId, agentId: 'agent-1', userId } as never)
  const listThreads = () => convex.query(threads('listThreadsByServer', 'query'), base) as Promise<Array<{ conversationId: string; archivedAt?: number; isMain: boolean }>>
  const listArchived = () => convex.query(threads('listArchivedThreadsByServer', 'query'), { serverSecret: secret, workspaceId, userId }) as Promise<Array<{ conversationId: string; agentId: string; agentArchived: boolean }>>
  const listAgents = () => convex.query(agentsFn('listByServer', 'query'), { serverSecret: secret, workspaceId, includeArchived: true }) as Promise<Array<{ agentId: string; archivedAt?: number }>>
  return { convex, resolveMain, createThread, setArchived, deleteThread, listThreads, listArchived, listAgents }
}

describe('archiving an agent thread', () => {
  test('lands only the thread in the archive; the agent stays live and is not archived', async () => {
    const t = await seed()
    const main = await t.resolveMain()
    const second = await t.createThread('Second')
    await t.setArchived(second.conversationId, true)

    expect((await t.listArchived()).map((row) => [row.conversationId, row.agentId, row.agentArchived])).toEqual([[second.conversationId, 'agent-1', false]])
    const agents = await t.listAgents()
    expect(agents).toHaveLength(1)
    expect(agents[0]!.archivedAt).toBeUndefined()
    // The other thread is untouched and still the one the agent opens into.
    expect((await t.resolveMain()).conversationId).toBe(main.conversationId)
  })

  test('archiving the main thread makes the agent open into a different, active thread', async () => {
    const t = await seed()
    const main = await t.resolveMain()
    const second = await t.createThread('Second')
    await t.setArchived(main.conversationId, true)
    expect((await t.resolveMain()).conversationId).toBe(second.conversationId)
    expect((await t.listThreads()).find((row) => row.isMain)?.conversationId).toBe(second.conversationId)
  })

  test('archiving the only thread: the agent starts a fresh thread instead of opening the archived one', async () => {
    const t = await seed()
    const only = await t.resolveMain()
    await t.setArchived(only.conversationId, true)
    const fresh = await t.resolveMain()
    expect(fresh.conversationId).not.toBe(only.conversationId)
    // Opening again lands on the fresh thread, not a third one.
    expect((await t.resolveMain()).conversationId).toBe(fresh.conversationId)
    expect((await t.listArchived()).map((row) => row.conversationId)).toEqual([only.conversationId])
  })

  test('restoring a thread removes it from the archive', async () => {
    const t = await seed()
    await t.resolveMain()
    const second = await t.createThread('Second')
    await t.setArchived(second.conversationId, true)
    await t.setArchived(second.conversationId, false)
    expect(await t.listArchived()).toEqual([])
  })
})

describe('deleting an archived agent thread', () => {
  test('deletes only that thread; the agent stays active, even when it was the only thread', async () => {
    const t = await seed()
    const only = await t.resolveMain()
    // An active last thread is protected...
    await expect(t.deleteThread(only.conversationId)).rejects.toThrow('AGENT_LAST_THREAD')
    // ...an archived one is not.
    await t.setArchived(only.conversationId, true)
    await t.deleteThread(only.conversationId)
    expect(await t.listArchived()).toEqual([])
    const agents = await t.listAgents()
    expect(agents.map((agent) => agent.agentId)).toEqual(['agent-1'])
    expect(agents[0]!.archivedAt).toBeUndefined()
    // The agent still works: opening it starts a fresh thread.
    const fresh = await t.resolveMain()
    expect(fresh.conversationId).not.toBe(only.conversationId)
    expect((await t.listThreads()).map((row) => row.conversationId)).toEqual([fresh.conversationId])
  })
})

describe('deleting an archived agent for good', () => {
  test('only an archived agent can be deleted; it disappears everywhere and its threads go with it', async () => {
    const t = await seed()
    const main = await t.resolveMain()
    const args = { serverSecret: secret, agentId: 'agent-1', workspaceId, now }
    // A live agent is refused.
    expect(await t.convex.mutation(agentsFn('deleteArchivedByServer', 'mutation'), args)).toBe(false)
    expect(await t.listAgents()).toHaveLength(1)

    await t.convex.mutation(agentsFn('archiveByServer', 'mutation'), args)
    expect(await t.convex.mutation(agentsFn('deleteArchivedByServer', 'mutation'), args)).toBe(true)
    expect(await t.listAgents()).toEqual([])
    const conversation = await t.convex.run(async (ctx) => ctx.db.get(main.conversationId as never))
    expect((conversation as { deletedAt?: number }).deletedAt).toBe(now)
    // Deleting twice is a no-op.
    expect(await t.convex.mutation(agentsFn('deleteArchivedByServer', 'mutation'), args)).toBe(false)
  })

  test('an archived thread of a deleted agent no longer appears in the archive', async () => {
    const t = await seed()
    await t.resolveMain()
    const second = await t.createThread('Second')
    await t.setArchived(second.conversationId, true)
    const args = { serverSecret: secret, agentId: 'agent-1', workspaceId, now }
    await t.convex.mutation(agentsFn('archiveByServer', 'mutation'), args)
    expect((await t.listArchived())[0]?.agentArchived).toBe(true)
    await t.convex.mutation(agentsFn('deleteArchivedByServer', 'mutation'), args)
    expect(await t.listArchived()).toEqual([])
  })
})
