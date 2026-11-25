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
  // A turn waiting for its owner keeps the run open until the owner answers.
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

test('a run waiting for its owner does not hold the schedule; a working run does', async () => {
  const { convex, automationId, now } = await fixture()
  const claim = makeFunctionReference<'mutation'>('automations/automations:claimDueRuns')
  const { conversationId } = await convex.mutation(bindThread, { automationId, userId: 'alice', serverSecret: secret })
  const { runId, agentRunId } = await convex.run(async ctx => {
    await ctx.db.insert('billingAccounts', { billingAccountId: 'paid', workspaceId: 'workspace', scope: 'workspace',
      status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: now, updatedAt: now })
    await ctx.db.insert('billingAccountSubscriptions', { billingAccountId: 'paid', provider: 'stripe', planKind: 'paid',
      planVersion: 'variable_v2', planAmountCents: 2000, markupBasisPoints: 2500, status: 'active',
      autoTopUpEnabled: false, autoTopUpAmountCents: 0, createdAt: now, updatedAt: now })
    await ctx.db.patch(automationId, { enabled: true, nextRunAt: now - 1_000 })
    const runId = await ctx.db.insert('automationRuns', {
      automationId, userId: 'alice', status: 'running', scheduledFor: now - 60_000, startedAt: now - 60_000,
      conversationId, createdAt: now - 60_000, updatedAt: now - 60_000,
    })
    const messageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'alice', turnId: `automation-run:${runId}`, role: 'user', mode: 'act',
      content: 'Triage my inbox.', contentType: 'text', createdAt: now - 60_000,
    })
    await ctx.db.patch(runId, { messageId, workflowRunId: `automation-thread:${runId}`, turnId: `automation-run:${runId}` })
    const agentRunId = await ctx.db.insert('conversationAgentRuns', {
      conversationId, userId: 'alice', userMessageId: messageId, assistantMessageId: messageId,
      turnId: `automation-run:${runId}`, mode: 'chat', runner: 'workflow', status: 'waiting_for_input',
      createdAt: now - 59_000, updatedAt: now - 59_000,
    })
    return { runId, agentRunId }
  })

  // Waiting for the owner: the due tick starts a new run instead of skipping.
  expect(await convex.mutation(claim, { now })).toHaveLength(1)
  expect(await convex.run(ctx => ctx.db.get(runId))).toMatchObject({ status: 'running' })

  // Still working: the next due tick is skipped.
  await convex.run(async ctx => {
    const queued = await ctx.db.query('automationRuns').withIndex('by_automationId_status', q => q.eq('automationId', automationId).eq('status', 'queued')).collect()
    for (const run of queued) await ctx.db.patch(run._id, { status: 'completed', completedAt: now })
    await ctx.db.patch(agentRunId, { status: 'running' })
    await ctx.db.patch(automationId, { nextRunAt: now - 1_000 })
  })
  expect(await convex.mutation(claim, { now })).toEqual([])
})

test('an automation runs only as an agent its creator can open a thread with', async () => {
  const convex = convexTest(schema, modules)
  const now = Date.now()
  await convex.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'workspace', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: now, updatedAt: now })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { principalId: `p-${userId}`, workspaceId: 'workspace', type: 'human', userId, displayName: userId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { membershipId: `m-${userId}`, workspaceId: 'workspace', principalId: `p-${userId}`, role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    }
    const agent = async (agentId: string, fields: Record<string, unknown>) => {
      const workspaceId = (fields.workspaceId as string | undefined) ?? 'workspace'
      await ctx.db.insert('workspacePrincipals', { principalId: `ap-${agentId}`, workspaceId, type: 'agent', agentId, displayName: agentId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceAgentDefinitions', {
        agentId, workspaceId, principalId: `ap-${agentId}`, name: agentId, instructions: 'Help.', harness: 'overlay',
        modelId: 'model', allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'p-alice',
        createdAt: now, updatedAt: now, ...fields,
      } as never)
    }
    await agent('shared', { visibility: 'workspace' })
    await agent('private', { visibility: 'creator' })
    await agent('archived', { visibility: 'workspace', archivedAt: now })
    await agent('elsewhere', { visibility: 'workspace', workspaceId: 'other-workspace' })
  })
  const create = (userId: string, agentId: string, scope: 'personal' | 'workspace' = 'personal') =>
    convex.mutation(makeFunctionReference<'mutation'>('automations/automations:create'), {
      serverSecret: secret, workspaceId: 'workspace', userId, name: '', instructions: 'Check in.', enabled: false,
      schedule: { kind: 'daily', hour: 9, minute: 0 }, timezone: 'America/Los_Angeles', scope, agentId,
    })

  await expect(create('bob', 'private')).rejects.toThrow(/AGENT_NOT_FOUND/)
  await expect(create('alice', 'private', 'workspace')).rejects.toThrow(/AGENT_NOT_FOUND/)
  await expect(create('alice', 'archived')).rejects.toThrow(/AGENT_NOT_FOUND/)
  await expect(create('alice', 'elsewhere')).rejects.toThrow(/AGENT_NOT_FOUND/)
  const own = await create('alice', 'private') as Id<'automations'>
  expect((await convex.run(ctx => ctx.db.get(own)))?.agentId).toBe('private')
  const shared = await create('bob', 'shared', 'workspace') as Id<'automations'>
  expect((await convex.run(ctx => ctx.db.get(shared)))?.agentId).toBe('shared')
})

test('moving an automation to the workspace re-checks its agent and can take a private agent along', async () => {
  const convex = convexTest(schema, modules)
  const now = Date.now()
  const ids = await convex.run(async ctx => {
    await ctx.db.insert('workspaces', { workspaceId: 'workspace', kind: 'organization', name: 'QA', slug: 'qa', status: 'active', createdAt: now, updatedAt: now })
    for (const userId of ['alice', 'bob']) {
      await ctx.db.insert('workspacePrincipals', { principalId: `p-${userId}`, workspaceId: 'workspace', type: 'human', userId, displayName: userId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceMemberships', { membershipId: `m-${userId}`, workspaceId: 'workspace', principalId: `p-${userId}`, role: 'member', status: 'active', joinedAt: now, updatedAt: now })
    }
    const agent = async (agentId: string, fields: Record<string, unknown>) => {
      await ctx.db.insert('workspacePrincipals', { principalId: `ap-${agentId}`, workspaceId: 'workspace', type: 'agent', agentId, displayName: agentId, createdAt: now, updatedAt: now })
      await ctx.db.insert('workspaceAgentDefinitions', {
        agentId, workspaceId: 'workspace', principalId: `ap-${agentId}`, name: agentId, instructions: 'Help.', harness: 'overlay',
        modelId: 'model', allowedToolIds: [], invocationPolicy: 'mention', createdByPrincipalId: 'p-alice',
        createdAt: now, updatedAt: now, ...fields,
      } as never)
    }
    await agent('shared', { visibility: 'workspace' })
    await agent('private', { visibility: 'creator' })
    await agent('chief', { visibility: 'creator', agentRole: 'personal_chief', chiefScope: 'personal', chiefOwnerUserId: 'alice' })
    const channel = await ctx.db.insert('conversations', {
      userId: 'alice', workspaceId: 'workspace', conversationType: 'channel', channelVisibility: 'public', title: 'general',
      lastModified: now, createdAt: now, lastMode: 'ask', askModelIds: [], actModelId: 'model',
    } as never)
    const automation = (userId: string, agentId: string) => ctx.db.insert('automations', {
      userId, workspaceId: 'workspace', scope: 'personal', name: `${userId} ${agentId}`, instructions: 'Check in.', enabled: false,
      schedule: { kind: 'daily', hour: 9, minute: 0 }, agentId, createdAt: now, updatedAt: now,
    } as never)
    return {
      channel,
      withShared: await automation('alice', 'shared'),
      withPrivate: await automation('alice', 'private'),
      withChief: await automation('alice', 'chief'),
      bobsWithAlicesAgent: await automation('bob', 'private'),
    }
  })
  const move = (userId: string, id: string, withAgent?: boolean) => convex.mutation(makeFunctionReference<'mutation'>('automations/automations:setScope'), {
    serverSecret: secret, workspaceId: 'workspace', userId, id, to: 'workspace', ...(withAgent === undefined ? {} : { withAgent }),
  })
  const scopeOf = async (id: string) => ((await convex.run(ctx => ctx.db.get(id as Id<'automations'>))) as { scope?: string }).scope
  const privateAgent = () => convex.run(async ctx => await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', 'private')).unique())

  expect(await move('alice', ids.withShared)).toEqual({ ok: true })
  // A private agent blocks the move unless its creator takes it along; nothing is written on a refusal.
  expect(await move('alice', ids.withPrivate)).toEqual({ ok: false, reason: 'automation_agent_personal' })
  expect(await scopeOf(ids.withPrivate)).toBe('personal')
  expect((await privateAgent())?.visibility).toBe('creator')
  // Someone else's private agent, or a personal chief, can't come along.
  expect(await move('bob', ids.bobsWithAlicesAgent, true)).toEqual({ ok: false, reason: 'automation_agent_not_yours' })
  expect(await move('alice', ids.withChief, true)).toEqual({ ok: false, reason: 'automation_agent_chief' })
  expect(await scopeOf(ids.withChief)).toBe('personal')

  // Both move together, and the agent joins the public channels like a new workspace agent.
  expect(await move('alice', ids.withPrivate, true)).toEqual({ ok: true })
  expect(await scopeOf(ids.withPrivate)).toBe('workspace')
  expect((await privateAgent())?.visibility).toBe('workspace')
  const joined = await convex.run(async ctx => await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_principalId', q => q.eq('conversationId', ids.channel).eq('principalId', 'ap-private')).collect())
  expect(joined).toHaveLength(1)
  // Now that the agent is shared, bob's automation may move too.
  expect(await move('bob', ids.bobsWithAlicesAgent)).toEqual({ ok: true })
})
