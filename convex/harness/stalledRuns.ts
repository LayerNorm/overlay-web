import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery } from '../_generated/server'

/**
 * Finds runs whose workflow may have died while the run itself never ended (internal/plans/NEVER_STOP_RUNS_PLAN.md,
 * N2). A run still marked running with no update for a while is a candidate; the app then asks the Workflow SDK
 * whether its workflow is still alive and alerts on the ones that are not. Resuming such a run needs the runner's
 * checkpoint after every step, which is not persisted yet, so this only detects and alerts.
 */

const QUIET_MS = 20 * 60_000
const LOOKBACK_MS = 30 * 24 * 60 * 60_000
const PAGE_SIZE = 100
const MAX_PAGES = 100
const BATCH_LIMIT = 25

/**
 * One page of the quiet window, oldest first. Run status lives in the metadata JSON, so every run in the window is
 * read; paging keeps each read within Convex's limits however many finished runs sit in front of a stuck one.
 */
export const listCandidatesPage = internalQuery({
  args: { now: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { now, cursor }) => {
    const page = await ctx.db.query('harnessRuns')
      .withIndex('by_updatedAt', (q) => q.gte('updatedAt', now - LOOKBACK_MS).lte('updatedAt', now - QUIET_MS))
      .paginate({ cursor, numItems: PAGE_SIZE })
    const candidates: Array<{ runId: string; workflowRunId: string; updatedAt: number }> = []
    for (const row of page.page) {
      let metadata: { status?: string; workflowRunId?: string }
      try {
        metadata = JSON.parse(row.metadataJson) as typeof metadata
      } catch (_error) {
        continue
      }
      if (metadata.status !== 'running' || !metadata.workflowRunId) continue
      const alerted = await ctx.db.query('harnessStalledAlerts').withIndex('by_runId', (q) => q.eq('runId', row.runId)).first()
      if (alerted?.workflowRunId === metadata.workflowRunId) continue
      candidates.push({ runId: row.runId, workflowRunId: metadata.workflowRunId, updatedAt: row.updatedAt })
    }
    return { candidates, isDone: page.isDone, continueCursor: page.continueCursor }
  },
})

export const markAlerted = internalMutation({
  args: { runs: v.array(v.object({ runId: v.string(), workflowRunId: v.string() })) },
  handler: async (ctx, { runs }) => {
    const now = Date.now()
    for (const run of runs.slice(0, BATCH_LIMIT)) {
      const existing = await ctx.db.query('harnessStalledAlerts').withIndex('by_runId', (q) => q.eq('runId', run.runId)).first()
      if (existing) await ctx.db.patch(existing._id, { workflowRunId: run.workflowRunId, alertedAt: now })
      else await ctx.db.insert('harnessStalledAlerts', { ...run, alertedAt: now })
    }
  },
})

export const sweep = internalAction({
  args: {},
  handler: async (ctx) => {
    const { internal } = await import('../_generated/api')
    const now = Date.now()
    const candidates: Array<{ runId: string; workflowRunId: string }> = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES && candidates.length < BATCH_LIMIT; page++) {
      const result: { candidates: Array<{ runId: string; workflowRunId: string }>; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.harness.stalledRuns.listCandidatesPage, { now, cursor })
      candidates.push(...result.candidates)
      if (result.isDone) break
      cursor = result.continueCursor
    }
    const baseUrl = process.env.OVERLAY_BFF_URL?.replace(/\/$/, '')
    const secret = process.env.INTERNAL_API_SECRET
    if (!candidates.length || !baseUrl || !secret) return null
    const { fetchAppCallback } = await import('../lib/appCallback')
    try {
      const response = await fetchAppCallback(`${baseUrl}/api/v1/harness/stalled`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-api-secret': secret },
        body: JSON.stringify({ runs: candidates.slice(0, BATCH_LIMIT).map(({ runId, workflowRunId }) => ({ runId, workflowRunId })) }),
      })
      if (!response.ok) throw new Error(`harness_stalled_callback_${response.status}`)
      const { orphaned } = await response.json() as { orphaned?: Array<{ runId: string; workflowRunId: string }> }
      if (orphaned?.length) await ctx.runMutation(internal.harness.stalledRuns.markAlerted, { runs: orphaned })
    } catch (error) {
      console.warn('[HarnessStalled] sweep deferred', { error: error instanceof Error ? error.message : 'unknown' })
    }
    return null
  },
})
