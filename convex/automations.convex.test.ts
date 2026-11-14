import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import type { Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'automation-settlement-test-secret'
const markStarted = makeFunctionReference<'mutation'>('automations/automations:markManualRunStarted')
const settleRun = makeFunctionReference<'mutation'>('automations/automations:settleManualRunByServer')
const claimDueRuns = makeFunctionReference<'mutation'>('automations/automations:claimDueRuns')
const runAutomation = makeFunctionReference<'action'>('automations/automationRunner:runAutomation')
const recordWorkflow = makeFunctionReference<'mutation'>('automations/automations:updateRunWorkflowRunIdByServer')

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

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
    turnId: `automation-run:${runId}`,
    now,
  })
  expect(await convex.run(ctx => ctx.db.get(runId))).toMatchObject({
    status: 'running',
    workflowRunId: 'owner-workflow',
    conversationId,
    turnId: `automation-run:${runId}`,
  })
})

test('a run can only ever be bound to the turn ID derived from its run ID', async () => {
  const { convex, runId } = await createRun()
  for (const turnId of ['automation-run:run', `automation-${runId}-1700000000000`, 'anything']) {
    await expect(convex.mutation(markStarted, {
      runId, userId: 'alice', serverSecret: secret, expectedWorkflowRunId: 'owner-workflow', turnId, now: Date.now(),
    })).rejects.toThrow('Automation run turn ID must be derived from its run')
  }
  const run = await convex.run(ctx => ctx.db.get(runId))
  expect(run?.status).toBe('queued')
  expect(run?.turnId).toBeUndefined()
})

test('a scheduled run claimed by the cron is accepted by the run workflow (regression)', async () => {
  // Before the fix the cron stamped `automation-<runId>-<time>` as the turn ID,
  // so every scheduled run failed with "Automation run turn binding changed."
  vi.stubEnv('INTERNAL_SERVICE_AUTH_SECRET', 'automation-service-auth-secret')
  vi.stubEnv('AUTOMATION_RUNNER_BASE_URL', 'https://app.example')
  const requests: Array<{ url: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ ok: true, durable: true }), { status: 200 })
  }))
  const convex = convexTest(schema, modules)
  const now = Date.now()
  await convex.run(async ctx => {
    await ctx.db.insert('billingAccounts', { billingAccountId: 'paid', workspaceId: 'workspace', scope: 'workspace',
      status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2500, createdAt: now, updatedAt: now })
    await ctx.db.insert('billingAccountSubscriptions', { billingAccountId: 'paid', provider: 'stripe', planKind: 'paid',
      planVersion: 'variable_v2', planAmountCents: 2000, markupBasisPoints: 2500, status: 'active',
      autoTopUpEnabled: false, autoTopUpAmountCents: 0, createdAt: now, updatedAt: now })
    await ctx.db.insert('automations', {
      userId: 'alice', workspaceId: 'workspace', name: 'Scheduled', description: '', instructions: 'Do it.',
      enabled: true, schedule: { kind: 'interval', intervalMinutes: 180 }, nextRunAt: now - 1_000,
      createdAt: now, updatedAt: now,
    })
  })
  const [runId] = await convex.mutation(claimDueRuns, { now, limit: 5 }) as Array<Id<'automationRuns'>>
  expect(runId).toBeDefined()
  await convex.action(runAutomation, { runId })

  // The cron only claims the run: running, no turn or thread bound yet.
  const claimed = await convex.run(ctx => ctx.db.get(runId!))
  expect(claimed).toMatchObject({ status: 'running' })
  expect(claimed?.turnId).toBeUndefined()
  expect(claimed?.conversationId).toBeUndefined()
  expect(requests).toEqual([{ url: 'https://app.example/api/v1/automations/run', body: { runId } }])

  // The run workflow then acknowledges ownership and binds the derived turn.
  await convex.mutation(recordWorkflow, { runId, serverSecret: secret, workflowRunId: 'run-workflow' })
  await convex.mutation(markStarted, {
    runId, userId: 'alice', serverSecret: secret, expectedWorkflowRunId: 'run-workflow',
    turnId: `automation-run:${runId}`, now: Date.now(),
  })
  expect(await convex.run(ctx => ctx.db.get(runId!))).toMatchObject({
    status: 'running', workflowRunId: 'run-workflow', turnId: `automation-run:${runId}`,
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
