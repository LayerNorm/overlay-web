import 'server-only'

import { NextRequest } from 'next/server'
import { getRun } from 'workflow/api'
import { getWorld } from 'workflow/runtime'
import type { Event } from '@workflow/world'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { logger } from '@/server/observability/logger'

// ---------------------------------------------------------------------------
// GET /api/v1/automations/{runId}/events
//
// Streams workflow step events as Server-Sent Events (SSE). The client
// subscribes to this endpoint to get real-time per-node status updates
// for the live run visualization (Step 6).
//
// The endpoint polls the Workflow SDK's event log every 2 seconds and
// sends new events as SSE data lines. When the run reaches a terminal
// state (completed, failed, cancelled), the stream closes.
//
// Query params:
//   - cursor: Resume from a specific event cursor (for reconnection)
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 2000
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled'])

function toRunEvent(event: Event) {
  // eventData is optional on some event types (e.g. run_cancelled)
  const eventData = ('eventData' in event ? event.eventData : undefined) as
    | Record<string, unknown>
    | undefined
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    stepName: eventData?.stepName as string | undefined,
    attempt: eventData?.attempt as number | undefined,
    error: eventData?.error as string | undefined,
    stack: eventData?.stack as string | undefined,
    createdAt: event.createdAt.toISOString(),
  }
}

export async function GET(request: NextRequest, context?: AppApiRouteContext) {
  try {
    const params = await context?.params ?? {}
    const workflowRunId = (params['runId'] ?? params['id']) as string | undefined
    if (!workflowRunId) {
      return new Response(JSON.stringify({ error: 'runId is required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }

    if (!context?.auth.userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }

    const url = new URL(request.url)
    const resumeCursor = url.searchParams.get('cursor') ?? undefined

    // Set up SSE stream
    const encoder = new TextEncoder()
    let cancelled = false
    let cursor = resumeCursor

    const stream = new ReadableStream({
      async start(controller) {
        function sendEvent(data: unknown) {
          if (cancelled) return
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        function sendComment(text: string) {
          if (cancelled) return
          controller.enqueue(encoder.encode(`: ${text}\n\n`))
        }

        // Send initial connection confirmation
        sendEvent({ type: 'connected', workflowRunId })

        try {
          const world = getWorld()
          const run = getRun(workflowRunId)

          // Check if run exists
          const exists = await run.exists
          if (!exists) {
            sendEvent({ type: 'error', error: 'Workflow run not found' })
            controller.close()
            return
          }

          while (!cancelled) {
            // Get current run status
            const runStatus = await run.status

            // Fetch events page
            const eventPage = await world.events.list({
              runId: workflowRunId,
              pagination: cursor ? { cursor } : undefined,
              resolveData: 'none',
            })

            // Send new events
            for (const event of eventPage.data) {
              sendEvent({
                type: 'event',
                event: toRunEvent(event),
              })
            }

            // Update cursor
            if (eventPage.cursor) {
              cursor = eventPage.cursor
            }

            // Check if run is terminal
            if (TERMINAL_RUN_STATUSES.has(runStatus)) {
              sendEvent({ type: 'terminal', runStatus })
              controller.close()
              return
            }

            // Send heartbeat comment to keep connection alive
            sendComment(`heartbeat ${new Date().toISOString()}`)

            // Wait before next poll
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
          }
        } catch (error) {
          logger.error('[automations/[runId]/events]', error)
          const message = error instanceof Error ? error.message : 'Unknown error'
          sendEvent({ type: 'error', error: message })
        }

        controller.close()
      },
      cancel() {
        cancelled = true
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    })
  } catch (error) {
    logger.error('[automations/[runId]/events]', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: 'Failed to stream events', message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}
