import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { readActivePublicStreams } from './lib/publicStreamRead'
import { seedPreviewWorkspace } from './dev/previewWorkspace'

const modules = import.meta.glob('./**/*.ts')
const init = makeFunctionReference<'mutation', Record<string, never>, {
  workspaceId: string; personalA: Id<'conversations'>; personalB: Id<'conversations'>;
  stream: Id<'conversations'>; dm: Id<'conversations'>; agent: Id<'conversations'>
}>('dev/performanceQa:init')
const start = makeFunctionReference<'mutation', { conversationId: Id<'conversations'> }, {
  conversationId: Id<'conversations'>; generation: number
}>('dev/performanceQa:startStreaming')
const tick = makeFunctionReference<'mutation'>('dev/performanceQa:tick')
const initCode = makeFunctionReference<'mutation', Record<string, never>, {
  workspaceId: string; conversationId: Id<'conversations'>
}>('dev/performanceQa:initCode')
const initPagination = makeFunctionReference<'mutation', { workspaceId?: string }, {
  workspaceId: string; conversationId: Id<'conversations'>
}>('dev/performanceQa:initPagination')
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

test.each(['production', 'development', 'staging', ''])('performance fixtures refuse %s', async environment => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', environment)
  const t = convexTest(schema, modules)
  await expect(t.mutation(init, {})).rejects.toThrow('Preview seed is unavailable')
  await expect(t.mutation(initCode, {})).rejects.toThrow('Preview seed is unavailable')
  await expect(t.mutation(initPagination, {})).rejects.toThrow('Preview seed is unavailable')
  expect(await t.run(ctx => ctx.db.query('conversations').collect())).toHaveLength(0)
})

test('code fixture requires the existing QA owner, is idempotent and refuses changed content', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_syntax_fixture')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'syntax@example.test')
  const t = convexTest(schema, modules)
  await expect(t.mutation(initCode, {})).rejects.toThrow('existing active QA owner')
  await t.run(ctx => seedPreviewWorkspace(ctx, { userId: 'user_syntax_fixture', email: 'syntax@example.test' }))
  const fixture = await t.mutation(initCode, {})
  expect(await t.mutation(initCode, {})).toEqual(fixture)
  const messages = await t.run(ctx => ctx.db.query('conversationMessages')
    .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', fixture.conversationId)).collect())
  expect(messages).toHaveLength(2)
  expect(messages.every(message => message.status === 'completed')).toBe(true)
  for (const language of ['javascript', 'python', 'overlay-qa-unknown', 'text']) {
    expect(messages[1].content).toContain(`\`\`\`${language}\n`)
  }
  expect(await t.run(ctx => ctx.db.query('conversationAgentRuns').collect())).toHaveLength(0)
  expect(await t.run(ctx => ctx.db.query('harnessRuns').collect())).toHaveLength(0)
  expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(0)
  await t.run(ctx => ctx.db.patch(messages[1]._id, { status: 'generating' }))
  await expect(t.mutation(initCode, {})).rejects.toThrow('fixture history changed')
  await t.run(ctx => ctx.db.patch(messages[1]._id, { status: 'completed' }))
  await t.run(ctx => ctx.db.patch(messages[1]._id, { content: 'Edited outside the fixture' }))
  await expect(t.mutation(initCode, {})).rejects.toThrow('fixture history changed')
  expect((await t.run(ctx => ctx.db.get(messages[1]._id)))?.content).toBe('Edited outside the fixture')
  await t.run(async ctx => {
    const member = await ctx.db.query('workspaceMemberships').withIndex('by_workspaceId_principalId',
      q => q.eq('workspaceId', fixture.workspaceId).eq('principalId', `${fixture.workspaceId}-owner`)).unique()
    await ctx.db.patch(member!._id, { role: 'member' })
  })
  await expect(t.mutation(initCode, {})).rejects.toThrow('existing active QA owner')
})

test('fixed histories are idempotent; public-stream replay is bounded, repeatable and provider-free', async () => {
  vi.useFakeTimers()
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_performance_fixture')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'performance@example.test')
  const t = convexTest(schema, modules)
  const fixtures = await t.mutation(init, {})
  for (const [id, count] of [[fixtures.personalA, 50], [fixtures.personalB, 50], [fixtures.agent, 1024], [fixtures.dm, 1000], [fixtures.stream, 50]] as const) {
    expect(await t.run(ctx => ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', id)).collect())).toHaveLength(count)
  }
  const before = await t.run(ctx => ctx.db.query('conversations').collect())
  expect(await t.mutation(init, {})).toEqual(fixtures)
  expect(await t.run(ctx => ctx.db.query('conversations').collect())).toEqual(before)
  expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').collect())).toHaveLength(0)
  await expect(t.mutation(start, { conversationId: fixtures.personalA })).rejects.toThrow('Not the configured performance stream fixture')
  const first = await t.mutation(start, { conversationId: fixtures.stream })
  await expect(t.mutation(start, { conversationId: fixtures.stream })).rejects.toThrow('already streaming')
  await t.mutation(tick, { conversationId: fixtures.stream, generation: first.generation, step: 1 })
  const stream = await t.run(ctx => ctx.db.query('harnessPublicStreams').withIndex('by_runId',
    q => q.eq('runId', `preview-performance-v1:${fixtures.stream}`)).unique())
  expect(await t.run(ctx => readActivePublicStreams(ctx, fixtures.stream, [stream!.assistantMessageId])))
    .toMatchObject([{ text: 'Synthetic stream paragraph 1. This deterministic text does not call a model.\n\n' }])
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const completed = await t.run(ctx => ctx.db.get(stream!.assistantMessageId))
  expect(completed?.status).toBe('completed')
  expect(completed?.content).toContain('Synthetic stream paragraph 80.')
  expect(await t.run(ctx => readActivePublicStreams(ctx, fixtures.stream, [stream!.assistantMessageId]))).toEqual([])
  const second = await t.mutation(start, { conversationId: fixtures.stream })
  expect(second.generation).toBe(first.generation + 1)
  await t.mutation(tick, { conversationId: fixtures.stream, generation: first.generation, step: 1 })
  expect((await t.run(ctx => ctx.db.get(stream!._id)))?.nextSequence).toBe(0)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect((await t.run(ctx => ctx.db.get(stream!.assistantMessageId)))?.content).toBe(completed?.content)
  for (const table of ['conversationAgentRuns', 'harnessRuns', 'harnessPublicStreams', 'harnessPublicStreamSegments'] as const) {
    expect(await t.run(ctx => ctx.db.query(table).collect())).toHaveLength(1)
  }
  expect(await t.run(ctx => ctx.db.query('conversationMessages')
    .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', fixtures.stream)).collect())).toHaveLength(50)
})

test('pagination fixture is a separate idempotent 120-row personal history and preserves baseline data', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_pagination_fixture')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'pagination@example.test')
  const t = convexTest(schema, modules)
  await expect(t.mutation(initPagination, {})).rejects.toThrow('existing active QA owner')

  const fixtures = await t.mutation(init, {})
  const baselineIds = [fixtures.personalA, fixtures.personalB, fixtures.stream, fixtures.dm]
  const readBaseline = () => t.run(async ctx => Promise.all(baselineIds.map(async conversationId => ({
    conversation: await ctx.db.get(conversationId),
    messages: await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', conversationId)).collect(),
  }))))
  const readSetupState = () => t.run(async ctx => ({
    workspaces: await ctx.db.query('workspaces').collect(),
    memberships: await ctx.db.query('workspaceMemberships').collect(),
    billingAccounts: await ctx.db.query('billingAccounts').collect(),
    balances: await ctx.db.query('billingAccountBalances').collect(),
    subscriptions: await ctx.db.query('billingAccountSubscriptions').collect(),
    agents: await ctx.db.query('workspaceAgentDefinitions').collect(),
    resourceScopes: await ctx.db.query('workspaceResourceScopes').collect(),
  }))
  const readPagination = (conversationId: Id<'conversations'>) => t.run(async ctx => ({
    conversation: await ctx.db.get(conversationId),
    messages: await ctx.db.query('conversationMessages')
      .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', conversationId)).collect(),
  }))
  const baselineBefore = await readBaseline()
  const setupBefore = await readSetupState()
  const fixture = await t.mutation(initPagination, {})
  const firstState = await readPagination(fixture.conversationId)

  expect(fixture.workspaceId).toBe(fixtures.workspaceId)
  expect(firstState.conversation).toMatchObject({
    userId: 'user_pagination_fixture',
    workspaceId: fixtures.workspaceId,
    conversationType: 'personal',
    title: 'Performance pagination',
    clientId: `preview-performance-v1-pagination-${fixtures.workspaceId}`,
  })
  expect(firstState.messages).toHaveLength(120)
  expect(firstState.messages.every(message => message.status === 'completed')).toBe(true)
  expect(firstState.messages[0]).toMatchObject({ role: 'user', contentType: 'text' })
  expect(firstState.messages[1]).toMatchObject({ role: 'assistant', contentType: 'text' })
  expect(firstState.messages.at(-1)).toMatchObject({
    role: 'assistant', content: 'Performance pagination final sentinel',
  })

  expect(await t.mutation(initPagination, {})).toEqual(fixture)
  expect(await readPagination(fixture.conversationId)).toEqual(firstState)
  expect(await readBaseline()).toEqual(baselineBefore)
  expect(await readSetupState()).toEqual(setupBefore)
  expect(await t.run(ctx => ctx.db.query('conversations').collect())).toHaveLength(6)
  await t.run(async ctx => {
    expect(await ctx.db.query('conversationAgentRuns').collect()).toHaveLength(0)
    expect(await ctx.db.query('harnessRuns').collect()).toHaveLength(0)
    expect(await ctx.db.query('workflowStepEvents').collect()).toHaveLength(0)
    expect(await ctx.db.system.query('_scheduled_functions').collect()).toHaveLength(0)
    expect(await ctx.db.query('knowledgeSources').collect()).toHaveLength(0)
    expect(await ctx.db.query('knowledgeChunks').collect()).toHaveLength(0)
  })

  const firstMessage = firstState.messages[0]
  await t.run(ctx => ctx.db.patch(firstMessage._id, { content: 'Edited outside the fixture' }))
  await expect(t.mutation(initPagination, {})).rejects.toThrow('Performance fixture history changed; inspect before reuse')
  expect((await t.run(ctx => ctx.db.get(firstMessage._id)))?.content).toBe('Edited outside the fixture')
})

test('pagination fixture can target a second active Preview workspace owned by the configured QA user', async () => {
  vi.stubEnv('OVERLAY_DEPLOYMENT_ENV', 'preview')
  vi.stubEnv('PREVIEW_LOGIN_USER_ID', 'user_second_pagination_fixture')
  vi.stubEnv('PREVIEW_LOGIN_EMAIL', 'second-pagination@example.test')
  const t = convexTest(schema, modules)
  const primary = await t.mutation(init, {})
  const secondWorkspaceId = `preview-computer-qa-${primary.workspaceId.slice('preview-qa-team-'.length)}`
  const now = 1
  const principalId = `${secondWorkspaceId}-owner`
  await t.run(async ctx => {
    await ctx.db.insert('workspaces', {
      workspaceId: secondWorkspaceId, kind: 'organization', name: 'Second Preview QA workspace',
      slug: secondWorkspaceId, status: 'active', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      principalId, workspaceId: secondWorkspaceId, userId: 'user_second_pagination_fixture',
      email: 'second-pagination@example.test', displayName: 'Preview QA', type: 'human',
      createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: `${principalId}-membership`, workspaceId: secondWorkspaceId, principalId,
      role: 'member', status: 'active', joinedAt: now, updatedAt: now,
    })
  })

  await expect(t.mutation(initPagination, { workspaceId: secondWorkspaceId }))
    .rejects.toThrow('existing active QA owner and workspace')
  await expect(t.mutation(initPagination, { workspaceId: `customer-${primary.workspaceId}` }))
    .rejects.toThrow('Preview QA workspaces')
  expect(await t.run(ctx => ctx.db.query('conversations').collect())).toHaveLength(5)

  const secondMembership = await t.run(ctx => ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', secondWorkspaceId).eq('principalId', principalId)).unique())
  await t.run(ctx => ctx.db.patch(secondMembership!._id, { role: 'owner' }))
  const fixture = await t.mutation(initPagination, { workspaceId: secondWorkspaceId })
  const messages = await t.run(ctx => ctx.db.query('conversationMessages')
    .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', fixture.conversationId)).collect())
  expect(fixture.workspaceId).toBe(secondWorkspaceId)
  expect(fixture.conversationId).not.toBe(primary.personalA)
  expect(messages).toHaveLength(120)
  expect(await t.mutation(initPagination, { workspaceId: secondWorkspaceId })).toEqual(fixture)
  expect(await t.run(ctx => ctx.db.query('conversations').collect())).toHaveLength(6)

  const deletedAt = Date.now()
  await t.run(ctx => ctx.db.patch(fixture.conversationId, { deletedAt }))
  await expect(t.mutation(initPagination, { workspaceId: secondWorkspaceId }))
    .rejects.toThrow('Performance fixture changed; inspect before reuse')
  expect((await t.run(ctx => ctx.db.get(fixture.conversationId)))?.deletedAt).toBe(deletedAt)
  expect(await t.run(ctx => ctx.db.query('conversations').collect())).toHaveLength(6)
})
