import { beforeAll, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type { Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'automation-settlement-test-secret'
const markStarted = makeFunctionReference<'mutation'>('automations/automations:markManualRunStarted')
const settleRun = makeFunctionReference<'mutation'>('automations/automations:settleManualRunByServer')

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

async function createRun(status: 'queued' | 'running' = 'queued') {
  const convex = convexTest(schema, modules)
  const now = Date.now()
  const { automationId, runId } = await convex.run(async ctx => {
    const automationId = await ctx.db.insert('automations', {
      userId: 'alice',
      workspaceId: 'workspace',
      name: 'Settlement test',
      description: '',
      instructions: 'Test owner-fenced settlement.',
      enabled: false,
      schedule: { kind: 'interval', intervalMinutes: 15 },
      createdAt: now,
      updatedAt: now,
    })
    const runId = await ctx.db.insert('automationRuns', {
      automationId,
      userId: 'alice',
      status,
      scheduledFor: now,
      triggerSource: 'manual',
      workflowRunId: 'owner-workflow',
      turnId: status === 'running' ? 'automation-run:run' : undefined,
      createdAt: now,
      updatedAt: now,
    })
    return { automationId, runId }
  })
  return { convex, automationId, runId: runId as Id<'automationRuns'> }
}

test('manual ACK starts a queued run and binds its canonical conversation and turn', async () => {
  const { convex, runId } = await createRun()
  const now = Date.now()
  const conversationId = await convex.run(ctx => ctx.db.insert('conversations', {
    userId: 'alice',
    title: 'Automation test',
    lastModified: now,
    updatedAt: now,
    createdAt: now,
    lastMode: 'act',
    askModelIds: ['fixture/model'],
    actModelId: 'fixture/model',
  }))
  await convex.mutation(markStarted, {
    runId,
    userId: 'alice',
    serverSecret: secret,
    expectedWorkflowRunId: 'owner-workflow',
    conversationId,
    turnId: 'automation-run:run',
    now,
  })
  expect(await convex.run(ctx => ctx.db.get(runId))).toMatchObject({
    status: 'running',
    workflowRunId: 'owner-workflow',
    conversationId,
    turnId: 'automation-run:run',
  })
})

test('terminal settlement atomically refuses foreign owner or turn and preserves the owned run', async () => {
  const { convex, runId } = await createRun('running')
  const base = {
    runId,
    userId: 'alice',
    serverSecret: secret,
    expectedStatus: 'running' as const,
    status: 'skipped' as const,
    error: 'Approval was denied.',
  }
  expect(await convex.mutation(settleRun, { ...base, expectedWorkflowRunId: 'other-workflow',
    expectedTurnId: 'automation-run:run' })).toBe(false)
  expect(await convex.mutation(settleRun, { ...base, expectedWorkflowRunId: 'owner-workflow',
    expectedTurnId: 'other-turn' })).toBe(false)
  expect(await convex.mutation(settleRun, { ...base, expectedWorkflowRunId: 'owner-workflow',
    expectedStatus: 'queued', expectedTurnId: 'automation-run:run' })).toBe(false)
  expect(await convex.run(ctx => ctx.db.get(runId))).toMatchObject({
    status: 'running',
    workflowRunId: 'owner-workflow',
    turnId: 'automation-run:run',
  })
  expect(await convex.mutation(settleRun, { ...base, expectedWorkflowRunId: 'owner-workflow',
    expectedTurnId: 'automation-run:run' })).toBe(true)
  expect(await convex.run(ctx => ctx.db.get(runId))).toMatchObject({
    status: 'skipped',
    error: 'Approval was denied.',
  })
})

test('a long-running automation run is never failed by age; only a never-started run expires after a day', async () => {
  const { convex, automationId, runId } = await createRun('running')
  const claim = makeFunctionReference<'mutation'>('automations/automations:claimDueRuns')
  const now = Date.now()
  const hour = 60 * 60_000
  await convex.run(async ctx => {
    await ctx.db.insert('billingAccounts', { billingAccountId: 'paid', workspaceId: 'workspace', scope: 'workspace',
      status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: now, updatedAt: now })
    await ctx.db.insert('billingAccountSubscriptions', { billingAccountId: 'paid', provider: 'stripe', planKind: 'paid',
      planVersion: 'variable_v2', planAmountCents: 2000, markupBasisPoints: 2500, status: 'active',
      autoTopUpEnabled: false, autoTopUpAmountCents: 0, createdAt: now, updatedAt: now })
    await ctx.db.patch(automationId, { enabled: true, nextRunAt: now - 1_000 })
    await ctx.db.patch(runId, { startedAt: now - 6 * hour, createdAt: now - 6 * hour })
  })
  // Six hours into a run: the next due tick is skipped and the run keeps going.
  expect(await convex.mutation(claim, { now })).toEqual([])
  expect(await convex.run(ctx => ctx.db.get(runId))).toMatchObject({ status: 'running' })
  expect(await convex.run(ctx => ctx.db.get(automationId))).toMatchObject({ enabled: true })

  const queuedId = await convex.run(async ctx => {
    await ctx.db.patch(runId, { status: 'completed', completedAt: now })
    await ctx.db.patch(automationId, { nextRunAt: now - 1_000 })
    return await ctx.db.insert('automationRuns', {
      automationId, userId: 'alice', status: 'queued', scheduledFor: now - 2 * hour,
      createdAt: now - 2 * hour, updatedAt: now - 2 * hour,
    })
  })
  // Two hours queued is not lost yet.
  expect(await convex.mutation(claim, { now })).toEqual([])
  expect(await convex.run(ctx => ctx.db.get(queuedId))).toMatchObject({ status: 'queued' })

  await convex.run(async ctx => {
    await ctx.db.patch(automationId, { nextRunAt: now - 1_000 })
    await ctx.db.patch(queuedId, { createdAt: now - 25 * hour })
  })
  // A run that never started within a day expires, and the due run is claimed.
  expect(await convex.mutation(claim, { now })).toHaveLength(1)
  expect(await convex.run(ctx => ctx.db.get(queuedId))).toMatchObject({
    status: 'failed', error: 'Automation run expired before execution could start.',
  })
})
