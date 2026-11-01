import 'server-only'

import { describeFailure } from '@/server/observability/failure-classification'
import { logger } from '@/server/observability/logger'

const SAFE_START_FAILURES = new Map([
  ['The surface binding or agent authorization changed.', 'SURFACE_AUTHORIZATION_CHANGED'],
  ['Surface source identity is invalid.', 'SURFACE_IDENTITY_INVALID'],
  ['Surface workspace authority changed.', 'SURFACE_AUTHORIZATION_CHANGED'],
  ['Surface conversation ownership changed.', 'SURFACE_OWNERSHIP_CHANGED'],
  ['Persisted surface execution identity changed.', 'SURFACE_IDENTITY_INVALID'],
  ['Persisted surface source principals changed.', 'SURFACE_AUTHORIZATION_CHANGED'],
  ['Persisted native surface delivery ownership changed.', 'SURFACE_OWNERSHIP_CHANGED'],
  ['Native surface execution record is unavailable.', 'SURFACE_EXECUTION_UNAVAILABLE'],
  ['Native surface workflow ownership changed.', 'SURFACE_OWNERSHIP_CHANGED'],
  ['The native agent delivery is no longer available.', 'NATIVE_DELIVERY_UNAVAILABLE'],
  ['This native Harness run has already ended.', 'NATIVE_RUN_ENDED'],
  ['Native Harness admission belongs to another workflow.', 'SURFACE_OWNERSHIP_CHANGED'],
  ['The native agent run identity is unavailable.', 'NATIVE_IDENTITY_UNAVAILABLE'],
  ['The persisted surface source does not own this native delivery.', 'SURFACE_OWNERSHIP_CHANGED'],
  ['The native agent room identity changed.', 'NATIVE_IDENTITY_CHANGED'],
  ['The agent is no longer available.', 'AGENT_UNAVAILABLE'],
  ['No agent model attempt succeeded', 'AGENT_MODEL_UNAVAILABLE'],
])

export function surfaceStartFailure(error: unknown, runId: string) {
  const description = describeFailure(error)
  const knownMessage = error instanceof Error ? error.message : ''
  const knownCode = SAFE_START_FAILURES.get(knownMessage)
  const diagnosticId = `surface-start:${runId}`
  logger.error('[surfaces/slack] native task could not start', { diagnosticId, ...description })
  const message = knownCode ? knownMessage
    : `Native task preparation or admission failed. The cause could not be safely displayed. Reference: ${diagnosticId}.`
  return { code: knownCode ?? 'SURFACE_PREPARATION_FAILED', message, retryable: false }
}
