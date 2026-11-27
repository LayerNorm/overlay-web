import { describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const now = 1_900_000_000_000
const q = (name: string) => makeFunctionReference<'query'>(name)
const m = (name: string) => makeFunctionReference<'mutation'>(name)

function run(runId: string, status: string, updatedAt: number, workflowRunId: string | null = `wrun_${runId}`) {
  return {
    runId, actorUserId: 'user', rootRunId: runId, activeDescendantCount: 0, sourceJson: '{}', admissionJson: '{}',
    metadataJson: JSON.stringify({ status, ...(workflowRunId ? { workflowRunId } : {}) }), createdAt: updatedAt, updatedAt,
  }
}

describe('stalled-run sweep', () => {
  test('picks quiet running runs once, and skips recent, finished, ownerless and already reported ones', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(async (ctx) => {
      await ctx.db.insert('harnessRuns', run('quiet', 'running', now - 60 * 60_000))
      await ctx.db.insert('harnessRuns', run('recent', 'running', now - 5 * 60_000))
      await ctx.db.insert('harnessRuns', run('done', 'completed', now - 60 * 60_000))
      await ctx.db.insert('harnessRuns', run('waiting', 'waiting_for_input', now - 60 * 60_000))
      await ctx.db.insert('harnessRuns', run('ownerless', 'running', now - 60 * 60_000, null))
      await ctx.db.insert('harnessRuns', run('reported', 'running', now - 2 * 60 * 60_000))
    })
    await convex.mutation(m('harness/stalledRuns:markAlerted'), { runs: [{ runId: 'reported', workflowRunId: 'wrun_reported' }] })

    const candidates = await convex.query(q('harness/stalledRuns:listCandidates'), { now })
    expect(candidates.map((candidate: { runId: string }) => candidate.runId)).toEqual(['quiet'])

    // A run reported under one workflow is picked again if a new workflow took it over and then went quiet too.
    await convex.run(async (ctx) => {
      const row = await ctx.db.query('harnessRuns').withIndex('by_runId', (index) => index.eq('runId', 'reported')).first()
      await ctx.db.patch(row!._id, { metadataJson: JSON.stringify({ status: 'running', workflowRunId: 'wrun_successor' }) })
    })
    const again = await convex.query(q('harness/stalledRuns:listCandidates'), { now })
    expect(again.map((candidate: { runId: string }) => candidate.runId).sort()).toEqual(['quiet', 'reported'])
  })
})
