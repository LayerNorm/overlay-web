import { describeAISDKFailure, readErrorField, PROVIDER_CONTENT_FILTER_REASON } from './ai-sdk-failure'
import {
  createHarnessDiagnostic,
  harnessDiagnosticMessage,
  stableHarnessDiagnosticId,
  type HarnessDiagnostic,
  type HarnessDiagnosticCode,
} from '@overlay/agent-runtime/harness-diagnostic'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { APICallError } from 'ai'

export { stableHarnessDiagnosticId }

export class HarnessPersistenceError extends Error {
  readonly code = 'HARNESS_PERSISTENCE_FAILED'

  constructor() {
    super('Harness persistence failed.')
    this.name = 'HarnessPersistenceError'
  }
}

export class HarnessAuthorizationError extends Error {
  readonly code = 'HARNESS_AUTHORIZATION_REVOKED'

  constructor() {
    super('Harness authorization was revoked.')
    this.name = 'HarnessAuthorizationError'
  }
}

export function harnessDiagnosticForFailure(
  runId: string,
  snapshot: HarnessSnapshot,
  error: unknown,
  stage: HarnessDiagnostic['stage'],
): HarnessDiagnostic {
  if (snapshot.diagnostic && (snapshot.status === 'failed'
    || (snapshot.status === 'completed' && snapshot.diagnostic.code === 'PERSISTENCE_FAILED'))) {
    return snapshot.diagnostic
  }
  const message = error instanceof Error ? error.message : ''
  const value = error && typeof error === 'object' ? error as {
    name?: unknown
    code?: unknown
    operationId?: unknown
    statusCode?: unknown
  } : {}
  let code: HarnessDiagnosticCode = 'UNKNOWN'
  let operationId = typeof value.operationId === 'string'
    ? value.operationId : snapshot.latestReceipt?.id ?? `failure:${snapshot.revision}`
  if (message === 'The authorized run deadline is exhausted.'
    || message === 'Harness deadline reached while waiting.') {
    code = 'TASK_DEADLINE'
  } else if (message === 'The authorized spending budget is exhausted.') {
    code = 'TASK_SPEND_LIMIT'
  } else if (stage === 'model'
    && /^Model budget reservation declined: (?:insufficient_credits|insufficient_budget)$/.test(message)) {
    code = 'WORKSPACE_FUNDS'
  } else if (error instanceof HarnessPersistenceError || value.code === 'HARNESS_PERSISTENCE_FAILED') {
    code = 'PERSISTENCE_FAILED'
    stage = 'persistence'
  } else if (snapshot.modelReservation?.dispatch) {
    code = 'MODEL_OUTCOME_UNKNOWN'
    stage = 'model'
    operationId = snapshot.modelReservation.id
  } else if (error instanceof HarnessAuthorizationError || value.code === 'HARNESS_AUTHORIZATION_REVOKED'
    || ['HARNESS_EXECUTION_NOT_OWNED', 'Harness request is not owned by an active execution.', 'HARNESS_RUN_NOT_FOUND', 'CONVERSATION_ACCESS_DENIED',
    'NOTE_ACCESS_DENIED', 'HARNESS_DELIVERY_ACCESS_DENIED', 'Native harness execution is no longer authorized.',
    'Native harness execution is not owned by this workflow.', 'Personal harness execution is not authorized to continue.',
    'Personal harness identity does not match its tooling context.', 'The root harness execution is no longer active.',
    'Native delivery identity changed.', 'Native delivery execution changed.', 'Personal harness identity is incomplete.',
    'The API key that authorized this run is no longer permitted.', 'Personal harness resource access has changed.',
    'Personal harness permissions have been revoked.', 'Automation agent permissions have been revoked.',
    'The model is no longer allowed by server policy.', 'Native workspace identity changed.',
    'Native agent or room access changed.', 'Native room participation was revoked.',
    'Room visibility changed; private context cannot be reused.',
    'The model is no longer an admitted native agent candidate.', 'Native harness permissions were revoked.',
    'Native harness model permission was revoked.', 'Native harness root is unavailable.',
    'Native surface source ownership changed.', 'The native model is no longer allowed by server policy.',
    'Tool is outside this harness run\'s capabilities.',
    'Personal harness authentication is not supported.', 'Native delivery does not own this descendant.',
    'Native harness lineage changed.', 'Invalid fallback delivery authority.', 'Invalid root delivery authority.',
    'Invalid personal delivery run.', 'Personal delivery ownership changed.', 'Invalid native fallback authority.',
    'Native delivery ownership changed.'].includes(message)) {
    code = 'AUTHORIZATION_REVOKED'
  } else if (APICallError.isInstance(error) && typeof value.statusCode === 'number') {
    if (value.statusCode === 408) code = 'PROVIDER_TIMEOUT'
    else if (value.statusCode === 429) code = 'PROVIDER_RATE_LIMIT'
    else if (value.statusCode >= 500) code = 'PROVIDER_UNAVAILABLE'
  } else if (stage === 'model' && snapshot.latestReceipt?.costMicros === 0
    && ['route_capacity', 'route_unavailable', 'route_interrupted'].includes(snapshot.latestReceipt.rejectionReason ?? '')) {
    if (snapshot.latestReceipt.rejectionReason === 'route_capacity') code = 'PROVIDER_RATE_LIMIT'
    else if (snapshot.latestReceipt.rejectionReason === 'route_unavailable') code = 'PROVIDER_UNAVAILABLE'
    else if (snapshot.latestReceipt.rejectionReason === 'route_interrupted') code = 'PROVIDER_TIMEOUT'
  } else if (value.name === 'TimeoutError' || value.name === 'APITimeoutError'
    || value.code === 'ETIMEDOUT' || value.code === 'ECONNABORTED') {
    code = 'PROVIDER_TIMEOUT'
  } else if (stage === 'tool' && value.code === 'HARNESS_TOOL_OUTCOME_UNKNOWN') {
    code = 'TOOL_OUTCOME_UNKNOWN'
  } else if (stage === 'tool' && snapshot.evidence.some(item => item.kind === 'tool_result' && item.verdict === 'failed')) {
    code = 'TOOL_FAILED'
  } else if (snapshot.blocker?.kind === 'stuck') {
    code = 'STAGNATION'
  }
  // Durable Workflow transport strips SDK prototypes. Match authored descriptions
  // and stable SDK names, never expose a raw provider message or nested payload.
  if (code === 'UNKNOWN') {
    const seen = new Set<object>()
    let current = error
    for (let depth = 0; depth < 4 && current && typeof current === 'object' && !seen.has(current); depth++) {
      seen.add(current)
      const name = readErrorField(current, 'name')
      const description = name === 'HarnessModelFailure'
        ? readErrorField(current, 'message') : describeAISDKFailure(current)
      if (typeof description === 'string') {
        if (description === PROVIDER_CONTENT_FILTER_REASON) code = 'PROVIDER_REJECTED'
        else if (description.startsWith('The model provider rate limit or quota was exceeded.')) code = 'PROVIDER_RATE_LIMIT'
        else if (description.startsWith('The model provider encountered a server error.')) code = 'PROVIDER_UNAVAILABLE'
        else if (description.startsWith('The model provider request timed out.')) code = 'PROVIDER_TIMEOUT'
      }
      if (code !== 'UNKNOWN') break
      current = readErrorField(current, 'cause')
    }
  }
  const occurredAt = Date.now()
  const revision = snapshot.revision
  const id = stableHarnessDiagnosticId(runId, operationId, revision)
  return createHarnessDiagnostic({ diagnosticId: id, code, stage, operationId, occurredAt })
}

export function harnessDiagnosticTerminalError(diagnostic: HarnessDiagnostic) {
  const { operationId: _operationId, ...publicDiagnostic } = diagnostic
  return {
    code: `harness_${diagnostic.code.toLowerCase()}`,
    message: harnessDiagnosticMessage(diagnostic),
    retryable: diagnostic.retryability === 'automatic' || diagnostic.retryability === 'user_action',
    diagnostic: publicDiagnostic,
  }
}
