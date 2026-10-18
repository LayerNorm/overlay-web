import 'server-only'
import { randomUUID } from 'node:crypto'
import * as Sentry from '@sentry/nextjs'
import { describeFailure } from './failure-classification'
import { getObservabilityContext } from './context'
import { logger } from './logger'

/** Report caught 500s explicitly; logging a caught exception does not capture a Sentry event. */
export function reportAgentFailure(failure: unknown): string {
  const diagnosticId = randomUUID().replaceAll('-', '')
  const description = describeFailure(failure)
  const context = getObservabilityContext()
  const diagnostic = { diagnosticId, ...description, ...context }
  logger.error('[agent-environments] request failed', diagnostic)
  try {
    Sentry.captureEvent({
      event_id: diagnosticId,
      level: 'error',
      message: 'agent_environment_request_failure',
      tags: { agent_failure: 'true', failure_class: description.failureClass,
        failure_signature: description.failureSignature ?? 'UNCLASSIFIED' },
      fingerprint: ['agent_environment_request_failure', context.route ?? 'unknown',
        description.convexPath ?? 'unknown', description.failureSignature ?? description.failureClass],
      contexts: { agent_failure: diagnostic },
    })
  } catch (_error) {
    // Reporting must never replace the original failure or prevent its correlation header.
    logger.warn('[agent-environments] diagnostic delivery unavailable', { diagnosticId })
  }
  return diagnosticId
}
