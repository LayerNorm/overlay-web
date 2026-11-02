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
