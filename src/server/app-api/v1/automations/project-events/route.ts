import { getRun } from 'workflow/api'
import { getWorld } from 'workflow/runtime'
import type { Event } from '@workflow/world'
import { WorkflowProjectionRequest, type WorkflowProjectionPage } from '@/shared/schemas/workflow-projection'
import { getInternalApiSecret, matchesInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'

export function projectableEvent(event: Event): WorkflowProjectionPage['events'] {
  switch (event.eventType) {
    case 'step_created': case 'step_completed': case 'step_failed': case 'step_retrying': {
      const data = event.eventData
      const error = 'error' in data && typeof data.error === 'string' ? data.error.slice(0, 500) : undefined
      const stack = 'stack' in data && typeof data.stack === 'string' ? data.stack.slice(0, 1000) : undefined
      return [{
        sourceEventId: event.eventId, correlationId: event.correlationId, createdAt: event.createdAt.getTime(),
        stepStatus: event.eventType === 'step_completed' ? 'completed' : event.eventType === 'step_failed' ? 'failed' : 'running',
        ...(data.stepName ? {stepName: data.stepName} : {}), ...(error ? {error} : {}), ...(stack ? {stack} : {}),
      }]
    }
    default: return []
  }
}

async function readPage(input: {workflowRunId: string; cursor: string | null}): Promise<WorkflowProjectionPage> {
  // Read terminal status first so an event arriving during this read is revisited next tick.
  const status = await getRun(input.workflowRunId).status
  const world = await getWorld()
  const page = await world.events.list({
    runId: input.workflowRunId, resolveData: 'none',
    pagination: {limit: 100, sortOrder: 'asc', ...(input.cursor ? {cursor: input.cursor} : {})},
  })
  return {
    cursor: page.cursor ?? input.cursor,
    complete: !page.hasMore && ['completed', 'failed', 'cancelled'].includes(status),
    events: page.data.flatMap(projectableEvent),
  }
}

/** Deployment-scoped worker bridge: no member session grants access. */
export async function POST(request: Request, read = readPage) {
  let authorized = false
  try { authorized = matchesInternalApiSecret(request.headers.get('x-internal-api-secret'), getInternalApiSecret()) } catch (_error) { /* fail closed */ }
  if (!authorized) return Response.json({error: 'Unauthorized'}, {status: 401})
  const parsed = WorkflowProjectionRequest.safeParse(await request.json().catch((_error) => null))
  if (!parsed.success) return Response.json({error: 'Invalid projection request'}, {status: 400})
  try {
    return Response.json(await read(parsed.data), {headers: {'cache-control': 'no-store'}})
  } catch (error) {
    logger.error('[workflow projection] SDK read failed', {type: error instanceof Error ? error.name : 'unknown'})
    return Response.json({error: 'Workflow projection unavailable'}, {status: 503})
  }
}
