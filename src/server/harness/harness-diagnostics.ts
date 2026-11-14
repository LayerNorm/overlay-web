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

// Prefixes of describeAISDKFailure's 4xx descriptions, matched when transport strips SDK prototypes.
const providerAccountFailures = [
  'The model provider rejected authentication.',
  'The model provider requires payment or credits.',
  'The model provider denied access to the requested resource.',
]
const providerRequestFailures = [
  'The model provider rejected the request as invalid.',
  'The requested model or provider endpoint was not found.',
  'The model provider rejected the request because it was too large.',
]

/**
 * Provider recorded on the zero-usage receipt of a model call that ended before
 * the provider reported usage (the stream dropped, timed out or omitted usage).
 */
export const INTERRUPTED_MODEL_CALL_PROVIDER = 'interrupted'

function interruptedModelCallIsLatest(snapshot: HarnessSnapshot): boolean {
  const receipt = snapshot.latestReceipt
  return receipt?.provider === INTERRUPTED_MODEL_CALL_PROVIDER && snapshot.modelRecovery?.receiptId === receipt.id
}

/**
 * Classifies a model call failure from the provider error alone: HTTP status,
 * timeout names, or the authored descriptions that survive durable transport.
 * Returns UNKNOWN when the error says nothing about the provider.
 */
function harnessProviderFailureCode(error: unknown): HarnessDiagnosticCode {
  if (APICallError.isInstance(error) && typeof error.statusCode === 'number') {
    const status = error.statusCode
    if (status === 408) return 'PROVIDER_TIMEOUT'
    if (status === 429) return 'PROVIDER_RATE_LIMIT'
    if (status >= 500) return 'PROVIDER_UNAVAILABLE'
    if ([401, 402, 403].includes(status)) return 'PROVIDER_ACCOUNT'
    if (status >= 400) return 'PROVIDER_REQUEST_INVALID'
  }
  const name = readErrorField(error, 'name')
  const errorCode = readErrorField(error, 'code')
  if (name === 'TimeoutError' || name === 'APITimeoutError' || errorCode === 'ETIMEDOUT' || errorCode === 'ECONNABORTED') {
    return 'PROVIDER_TIMEOUT'
  }
  // Durable Workflow transport strips SDK prototypes. Match authored descriptions
  // and stable SDK names, never expose a raw provider message or nested payload.
  const seen = new Set<object>()
  let current = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object' && !seen.has(current); depth++) {
    seen.add(current)
    const currentName = readErrorField(current, 'name')
    const description = currentName === 'HarnessModelFailure'
      ? readErrorField(current, 'message') : describeAISDKFailure(current)
    if (typeof description === 'string') {
      if (description === PROVIDER_CONTENT_FILTER_REASON) return 'PROVIDER_REJECTED'
      if (description.startsWith('The model provider rate limit or quota was exceeded.')) return 'PROVIDER_RATE_LIMIT'
      if (description.startsWith('The model provider encountered a server error.')) return 'PROVIDER_UNAVAILABLE'
      if (description.startsWith('The model provider request timed out.')) return 'PROVIDER_TIMEOUT'
      if (providerAccountFailures.some(prefix => description.startsWith(prefix))) return 'PROVIDER_ACCOUNT'
      if (providerRequestFailures.some(prefix => description.startsWith(prefix))) return 'PROVIDER_REQUEST_INVALID'
    }
    current = readErrorField(current, 'cause')
  }
  return 'UNKNOWN'
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
    code?: unknown
    operationId?: unknown
  } : {}
  let code: HarnessDiagnosticCode = 'UNKNOWN'
  let operationId = typeof value.operationId === 'string'
    ? value.operationId : snapshot.latestReceipt?.id ?? `failure:${snapshot.revision}`
  if (message === 'The authorized run deadline is exhausted.'
    || message === 'Harness deadline reached while waiting.') {
    code = 'TASK_DEADLINE'
  } else if (stage === 'model' && (message === 'The workspace budget is under 2%.'
    || /^Model budget reservation declined: (?:insufficient_credits|insufficient_budget)$/.test(message))) {
    code = 'WORKSPACE_FUNDS'
  } else if (error instanceof HarnessPersistenceError || value.code === 'HARNESS_PERSISTENCE_FAILED') {
    code = 'PERSISTENCE_FAILED'
    stage = 'persistence'
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
  } else if (stage === 'model' && !snapshot.modelReservation?.dispatch && snapshot.latestReceipt?.costMicros === 0
    && ['route_capacity', 'route_unavailable', 'route_interrupted'].includes(snapshot.latestReceipt.rejectionReason ?? '')) {
    if (snapshot.latestReceipt.rejectionReason === 'route_capacity') code = 'PROVIDER_RATE_LIMIT'
    else if (snapshot.latestReceipt.rejectionReason === 'route_unavailable') code = 'PROVIDER_UNAVAILABLE'
    else if (snapshot.latestReceipt.rejectionReason === 'route_interrupted') code = 'PROVIDER_TIMEOUT'
  } else if (stage === 'tool' && value.code === 'HARNESS_TOOL_OUTCOME_UNKNOWN') {
    code = 'TOOL_OUTCOME_UNKNOWN'
  } else if (stage === 'tool' && snapshot.evidence.some(item => item.kind === 'tool_result' && item.verdict === 'failed')) {
    code = 'TOOL_FAILED'
  }
  // The real cause wins. A call that ended without usage is only reported as such
  // when nothing more specific is known about the failure.
  if (code === 'UNKNOWN') code = harnessProviderFailureCode(error)
  if (code === 'UNKNOWN' && (snapshot.modelReservation?.dispatch || interruptedModelCallIsLatest(snapshot))) {
    code = 'MODEL_OUTCOME_UNKNOWN'
    stage = 'model'
    if (snapshot.modelReservation?.dispatch) operationId = snapshot.modelReservation.id
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

/** One searchable line per failed run. Carries no prompt, output, credential or raw provider text. */
export function logHarnessFailure(runId: string, diagnostic: HarnessDiagnostic, error: unknown): void {
  const name = readErrorField(error, 'name')
  // eslint-disable-next-line no-console
  console.warn('[harness] run failed', {
    runId,
    diagnosticId: diagnostic.diagnosticId,
    code: diagnostic.code,
    stage: diagnostic.stage,
    errorName: typeof name === 'string' ? name.slice(0, 64) : typeof error,
  })
}
