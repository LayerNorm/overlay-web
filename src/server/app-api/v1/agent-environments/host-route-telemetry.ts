import { randomUUID } from 'node:crypto'
import { withObservabilityContext } from '@/server/observability/context'
import { logger } from '@/server/observability/logger'

export type AgentHostRoute = 'commands.poll' | 'events.upload' | 'commands.ack' | 'heartbeat'

/** Requests slower than this are logged even when they succeed. */
export const SLOW_AGENT_HOST_REQUEST_MS = 3_000

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/

/**
 * Wraps an Agent Host route: one request id shared by every log line it writes (including the failure line from
 * `agentEnvironmentErrorResponse`), returned to the host as `x-overlay-request-id` so a host warning can be matched
 * to the server log, and one outcome line for failed or slow requests. Healthy fast polls stay silent.
 */
export async function withAgentHostRouteTelemetry(
  route: AgentHostRoute,
  request: Request,
  handler: () => Promise<Response>,
  now: () => number = () => performance.now(),
): Promise<Response> {
  const supplied = request.headers.get('x-vercel-id')?.trim()
  const requestId = supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID()
  const startedAt = now()
  return await withObservabilityContext({ requestId, route: `agent-host/${route}` }, async () => {
    const response = await handler()
    const durationMs = Math.round(now() - startedAt)
    response.headers.set('x-overlay-request-id', requestId)
    if (response.status >= 500) {
      logger.error('[agent-host] request failed', { hostRoute: route, status: response.status, durationMs })
    } else if (response.status >= 400) {
      logger.warn('[agent-host] request rejected', { hostRoute: route, status: response.status, durationMs })
    } else if (durationMs >= SLOW_AGENT_HOST_REQUEST_MS) {
      logger.warn('[agent-host] slow request', { hostRoute: route, status: response.status, durationMs })
    }
    return response
  })
}
