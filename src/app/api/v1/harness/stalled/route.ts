import { NextResponse } from 'next/server'
import { getRun } from 'workflow/api'
import { captureHarnessAlert } from '@/server/harness/harness-alerts'
import { getInternalApiSecret, matchesInternalApiSecret } from '@/server/shared/internal-api-secret'

/**
 * Internal callback for the Convex stalled-run sweep (internal/plans/NEVER_STOP_RUNS_PLAN.md, N2). For each run still
 * marked running with no recent update, asks the Workflow SDK whether its workflow is alive. A workflow that ended
 * (or no longer exists) while its run did not is an orphan: it is reported to Sentry and returned so Convex does not
 * report it again. Live workflows (a long model call, a durable wait) are left alone.
 */
const ENDED_WORKFLOW_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const MAX_RUNS = 25
const ID_PATTERN = /^[\w:.-]{1,256}$/

export async function POST(request: Request) {
  let authorized = false
  try {
    authorized = matchesInternalApiSecret(request.headers.get('x-internal-api-secret'), getInternalApiSecret())
  } catch (_error) {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  }
  if (!authorized) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { runs?: unknown }
  try {
    body = await request.json() as typeof body
  } catch (_error) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  if (!Array.isArray(body.runs)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const runs = body.runs.slice(0, MAX_RUNS).filter((run): run is { runId: string; workflowRunId: string } =>
    !!run && typeof run === 'object'
    && typeof (run as { runId?: unknown }).runId === 'string' && ID_PATTERN.test((run as { runId: string }).runId)
    && typeof (run as { workflowRunId?: unknown }).workflowRunId === 'string'
    && ID_PATTERN.test((run as { workflowRunId: string }).workflowRunId))

  const orphaned: Array<{ runId: string; workflowRunId: string; workflowStatus: string }> = []
  for (const run of runs) {
    let workflowStatus: string
    try {
      const workflow = getRun(run.workflowRunId)
      workflowStatus = await workflow.exists ? await workflow.status : 'missing'
    } catch (_error) {
      // The Workflow SDK could not answer; check again on the next sweep rather than guess.
      continue
    }
    if (workflowStatus !== 'missing' && !ENDED_WORKFLOW_STATUSES.has(workflowStatus)) continue
    orphaned.push({ ...run, workflowStatus })
    await captureHarnessAlert('harness_run_orphaned', {
      runId: run.runId, code: `WORKFLOW_${workflowStatus.toUpperCase()}`, workflowRunId: run.workflowRunId,
    })
  }
  return NextResponse.json({ orphaned: orphaned.map(({ runId, workflowRunId }) => ({ runId, workflowRunId })) })
}
