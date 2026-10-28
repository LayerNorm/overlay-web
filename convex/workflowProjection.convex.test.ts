import { afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const list = makeFunctionReference<'query'>('automations/workflowEventProjector:listActiveWorkflowRuns')
const page = makeFunctionReference<'mutation'>('automations/workflowEventProjector:recordProjectionPage')
const secret = 'projection-test'
afterEach(() => vi.unstubAllEnvs())

async function fixture() {
  vi.stubEnv('INTERNAL_API_SECRET', secret)
  const t = convexTest(schema, modules)
  const id = await t.run(async ctx => {
    const automationId = await ctx.db.insert('automations', {userId: 'owner', name: 'QA', instructions: 'QA',
      enabled: true, createdAt: Date.now(), updatedAt: Date.now()})
    return ctx.db.insert('automationRuns', {automationId, userId: 'owner', status: 'completed',
      workflowRunId: 'workflow-a', scheduledFor: Date.now(), createdAt: Date.now()})
  })
  return {t, id}
}

test('short terminal runs are selected, pages replay safely, correlated completion retains name and SDK time', async () => {
  const {t, id} = await fixture()
  expect(await t.query(list, {serverSecret: secret})).toHaveLength(1)
  const created = {sourceEventId: 'event-a', correlationId: 'step-1', stepName: 'executeNode', stepStatus: 'running', createdAt: 100}
  const first = {serverSecret: secret, automationRunId: id, workflowRunId: 'workflow-a', expectedCursor: null,
    cursor: 'page-2', complete: false, events: [created]}
  expect(await t.mutation(page, first)).toBe(1)
  expect(await t.mutation(page, first)).toBe(0)
  const completed = {sourceEventId: 'event-b', correlationId: 'step-1', stepStatus: 'completed', createdAt: 101}
  const last = {...first, expectedCursor: 'page-2', cursor: 'page-2', complete: true, events: [created, completed]}
  expect(await t.mutation(page, last)).toBe(1)
  expect(await t.mutation(page, last)).toBe(0)
  const rows = await t.run(ctx => ctx.db.query('workflowStepEvents').withIndex('by_workflowRunId_createdAt', q => q.eq('workflowRunId', 'workflow-a')).collect())
  expect(rows.map(r => [r.stepName, r.stepStatus, r.createdAt])).toEqual([['executeNode', 'running', 100], ['executeNode', 'completed', 101]])
  expect(await t.query(list, {serverSecret: secret})).toEqual([])
})

test('rejects a forged worker and mismatched parent before writing events', async () => {
  const {t, id} = await fixture()
  const args = {serverSecret: secret, automationRunId: id, workflowRunId: 'wrong-run', expectedCursor: null, cursor: null, complete: true, events: []}
  await expect(t.mutation(page, args)).rejects.toThrow('Projection run mismatch')
  await expect(t.mutation(page, {...args, serverSecret: 'wrong'})).rejects.toThrow('Unauthorized')
})
