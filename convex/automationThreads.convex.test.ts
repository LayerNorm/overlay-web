import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type { Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'automation-thread-test-secret'
const bindThread = makeFunctionReference<'mutation'>('automations/automations:bindThreadByServer')
const linkMessage = makeFunctionReference<'mutation'>('automations/automations:linkRunMessageByServer')
const outcome = makeFunctionReference<'query'>('automations/automations:getThreadRunOutcomeByServer')
const settleable = makeFunctionReference<'query'>('automations/automations:listSettleableThreadRuns')

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function fixture(overrides: { conversationId?: Id<'conversations'> } = {}) {
  const convex = convexTest(schema, modules)
  const now = Date.now()
  const automationId = await convex.run(async ctx => {
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'principal-alice', workspaceId: 'workspace', type: 'human', userId: 'alice',
      displayName: 'Alice', createdAt: now, updatedAt: now,
    })
    return await ctx.db.insert('automations', {
      userId: 'alice', workspaceId: 'workspace', name: 'Inbox triage', description: '',
      instructions: 'Triage my inbox.', enabled: false, schedule: { kind: 'interval', intervalMinutes: 60 },
      createdAt: now, updatedAt: now, ...overrides,
    })
  })
  return { convex, automationId, now }
}

test('a chat automation binds one ordinary chat thread and keeps it on every run', async () => {
  const { convex, automationId } = await fixture()
  const first = await convex.mutation(bindThread, { automationId, userId: 'alice', serverSecret: secret })
  expect(first).toMatchObject({ kind: 'chat', workspaceId: 'workspace' })
  const conversation = await convex.run(ctx => ctx.db.get(first.conversationId as Id<'conversations'>))
  expect(conversation).toMatchObject({
    userId: 'alice', workspaceId: 'workspace', conversationType: 'personal', title: 'Inbox triage',
  })
  expect(conversation?.isAutomation).toBeUndefined()
  expect(await convex.mutation(bindThread, { automationId, userId: 'alice', serverSecret: secret })).toEqual(first)
  expect((await convex.run(ctx => ctx.db.get(automationId)))?.conversationId).toBe(first.conversationId)
})

test('a legacy automation-owned thread is reused and listed as an ordinary chat', async () => {
  const convex = convexTest(schema, modules)
  const now = Date.now()
  const { automationId, conversationId } = await convex.run(async ctx => {
    const conversationId = await ctx.db.insert('conversations', {
      userId: 'alice', workspaceId: 'workspace', title: 'Old automation', isAutomation: true,
      lastModified: now, updatedAt: now, createdAt: now, lastMode: 'act', askModelIds: ['m'], actModelId: 'm',
    })
    const automationId = await ctx.db.insert('automations', {
      userId: 'alice', workspaceId: 'workspace', name: 'Old', instructions: 'x', conversationId,
      createdAt: now, updatedAt: now,
    })
    return { automationId, conversationId }
  })
  expect(await convex.mutation(bindThread, { automationId, userId: 'alice', serverSecret: secret }))
    .toEqual({ conversationId, kind: 'chat', workspaceId: 'workspace' })
  expect((await convex.run(ctx => ctx.db.get(conversationId)))?.isAutomation).toBeUndefined()
})

test('binding refuses another user and a wrong server secret', async () => {
  const { convex, automationId } = await fixture()
  await expect(convex.mutation(bindThread, { automationId, userId: 'mallory', serverSecret: secret })).rejects.toThrow('Unauthorized')
  await expect(convex.mutation(bindThread, { automationId, userId: 'alice', serverSecret: 'wrong' })).rejects.toThrow('Unauthorized')
})

test('a run settles from the thread turn its message started', async () => {
  const { convex, automationId, now } = await fixture()
  const { conversationId } = await convex.mutation(bindThread, { automationId, userId: 'alice', serverSecret: secret })
  const { runId, messageId } = await convex.run(async ctx => {
    const runId = await ctx.db.insert('automationRuns', {
      automationId, userId: 'alice', status: 'running', scheduledFor: now, startedAt: now,
      workflowRunId: 'pending', conversationId, createdAt: now, updatedAt: now,
    })
    await ctx.db.patch(runId, { workflowRunId: `automation-thread:${runId}`, turnId: `automation-run:${runId}` })
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'alice', turnId: `automation-run:${runId}`, role: 'user', mode: 'act',
      content: 'Triage my inbox.', contentType: 'text', createdAt: now,
    })
    return { runId, messageId }
  })
  const owner = `automation-thread:${runId}`
  await expect(convex.mutation(linkMessage, { runId, userId: 'alice', serverSecret: secret, expectedWorkflowRunId: 'other', messageId }))
    .rejects.toThrow('ownership changed')
  await convex.mutation(linkMessage, { runId, userId: 'alice', serverSecret: secret, expectedWorkflowRunId: owner, messageId })
  expect(await convex.query(outcome, { runId, serverSecret: secret })).toEqual({ status: 'pending' })

  const agentRunId = await convex.run(ctx => ctx.db.insert('conversationAgentRuns', {
    conversationId, userId: 'alice', userMessageId: messageId, assistantMessageId: messageId,
    turnId: `automation-run:${runId}`, mode: 'chat', runner: 'workflow', status: 'waiting_for_input',
    createdAt: now + 1, updatedAt: now + 1,
  }))
  // A turn waiting for its owner keeps the run open, so the schedule skips while it waits.
  expect(await convex.query(outcome, { runId, serverSecret: secret })).toEqual({ status: 'pending' })
  expect(await convex.query(settleable, { now: now + 2 })).toEqual([])

  await convex.run(ctx => ctx.db.patch(agentRunId, {
    status: 'failed', terminalError: { code: 'model', message: 'Model refused', retryable: false },
  }))
  expect(await convex.query(outcome, { runId, serverSecret: secret })).toEqual({ status: 'failed', error: 'Model refused' })
  expect(await convex.query(settleable, { now: now + 2 })).toEqual([{ runId, userId: 'alice' }])
})

test('a run whose message never reached its thread fails after the start timeout', async () => {
  const { convex, automationId, now } = await fixture()
  const runId = await convex.run(async ctx => {
    const runId = await ctx.db.insert('automationRuns', {
      automationId, userId: 'alice', status: 'running', scheduledFor: now, startedAt: now, createdAt: now, updatedAt: now,
    })
    await ctx.db.patch(runId, { workflowRunId: `automation-thread:${runId}` })
    return runId
  })
  expect(await convex.query(settleable, { now: now + 60_000 })).toEqual([])
  expect(await convex.query(settleable, { now: now + 16 * 60_000 })).toEqual([{ runId, userId: 'alice' }])
})
