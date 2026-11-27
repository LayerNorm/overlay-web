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

async function allCandidates(convex: ReturnType<typeof convexTest>) {
  const found: string[] = []
  let cursor: string | null = null
  for (let page = 0; page < 20; page++) {
    const result = await convex.query(q('harness/stalledRuns:listCandidatesPage'), { now, cursor }) as {
      candidates: Array<{ runId: string }>; isDone: boolean; continueCursor: string
    }
    found.push(...result.candidates.map((candidate) => candidate.runId))
    if (result.isDone) break
    cursor = result.continueCursor
  }
  return found.sort()
}

describe('stalled-run sweep', () => {
  test('picks quiet running runs, however many finished runs came after them, and skips recent, finished, ownerless and reported ones', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(async (ctx) => {
      await ctx.db.insert('harnessRuns', run('quiet', 'running', now - 60 * 60_000))
      await ctx.db.insert('harnessRuns', run('recent', 'running', now - 5 * 60_000))
      await ctx.db.insert('harnessRuns', run('done', 'completed', now - 60 * 60_000))
      await ctx.db.insert('harnessRuns', run('waiting', 'waiting_for_input', now - 60 * 60_000))
      await ctx.db.insert('harnessRuns', run('ownerless', 'running', now - 60 * 60_000, null))
      await ctx.db.insert('harnessRuns', run('reported', 'running', now - 2 * 60 * 60_000))
      // Many runs finished after a stuck one must not hide it from the sweep.
      await ctx.db.insert('harnessRuns', run('stuck-old', 'running', now - 20 * 24 * 60 * 60_000))
      for (let index = 0; index < 250; index++) {
        await ctx.db.insert('harnessRuns', run(`finished-${index}`, 'completed', now - 60 * 60_000 - index * 1000))
      }
    })
    await convex.mutation(m('harness/stalledRuns:markAlerted'), { runs: [{ runId: 'reported', workflowRunId: 'wrun_reported' }] })

    expect(await allCandidates(convex)).toEqual(['quiet', 'stuck-old'])

    // A run reported under one workflow is picked again if a new workflow took it over and then went quiet too.
    await convex.run(async (ctx) => {
      const row = await ctx.db.query('harnessRuns').withIndex('by_runId', (index) => index.eq('runId', 'reported')).first()
      await ctx.db.patch(row!._id, { metadataJson: JSON.stringify({ status: 'running', workflowRunId: 'wrun_successor' }) })
    })
    expect(await allCandidates(convex)).toEqual(['quiet', 'reported', 'stuck-old'])
  })
})
