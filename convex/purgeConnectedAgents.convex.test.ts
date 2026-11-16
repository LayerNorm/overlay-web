import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'purge-connected-agents-secret'
const ref = (kind: 'mutation' | 'query', name: string) => makeFunctionReference<typeof kind>(`migrations/purgeConnectedAgents:${name}`)

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

test('remote agent runs and the replies they wrote are deleted; native runs stay', async () => {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const conversationId = await ctx.db.insert('conversations', { userId: 'alice', title: 'Room', lastModified: 1, createdAt: 1, lastMode: 'act', askModelIds: [], actModelId: 'm', updatedAt: 1 } as never)
    const message = (status: string) => ctx.db.insert('conversationMessages', {
      conversationId, userId: 'alice', role: 'assistant', mode: 'act', turnId: 't', content: 'reply',
      contentType: 'text', status, createdAt: 1, updatedAt: 1,
    } as never)
    const userMessageId = await message('completed')
    const remoteReply = await message('completed')
    const nativeReply = await message('completed')
    await ctx.db.insert('remoteMessageTextChunks', { messageId: remoteReply, partIndex: 0, chunkIndex: 0, text: 'x' })
    const base = { conversationId, turnId: 't', userId: 'alice', userMessageId, mode: 'room', status: 'completed', createdAt: 1, updatedAt: 1 }
    const remoteRun = await ctx.db.insert('conversationAgentRuns', { ...base, assistantMessageId: remoteReply, runner: 'remote' } as never)
    const nativeRun = await ctx.db.insert('conversationAgentRuns', { ...base, assistantMessageId: nativeReply, runner: 'workflow' } as never)
    return { remoteReply, nativeReply, remoteRun, nativeRun }
  })
  const dry = await t.mutation(ref('mutation', 'purgeRemoteRuns') as never, { paginationOpts: { numItems: 100, cursor: null }, dryRun: true }) as { deleted: number }
  expect(dry.deleted).toBe(1)
  expect(await t.run(ctx => ctx.db.get(ids.remoteRun))).not.toBeNull()
  const result = await t.mutation(ref('mutation', 'purgeRemoteRuns') as never, { paginationOpts: { numItems: 100, cursor: null }, dryRun: false }) as { deleted: number; isDone: boolean }
  expect(result).toMatchObject({ deleted: 1, isDone: true })
  await t.run(async ctx => {
    expect(await ctx.db.get(ids.remoteRun)).toBeNull()
    expect(await ctx.db.get(ids.remoteReply)).toBeNull()
    expect(await ctx.db.query('remoteMessageTextChunks').collect()).toEqual([])
    expect(await ctx.db.get(ids.nativeRun)).not.toBeNull()
    expect(await ctx.db.get(ids.nativeReply)).not.toBeNull()
  })
})

test('removed tables report nothing left on a clean deployment, and credential listing needs the server secret', async () => {
  const t = convexTest(schema, modules)
  expect(await t.mutation(ref('mutation', 'purgeRemovedTables') as never, { dryRun: true })).toEqual({ deleted: {}, isDone: true })
  expect(await t.query(ref('query', 'listRetiredCredentialsByServer') as never, { serverSecret: secret })).toEqual([])
  await expect(t.query(ref('query', 'listRetiredCredentialsByServer') as never, { serverSecret: 'wrong' })).rejects.toThrow()
})
