import { describeAISDKFailure, readErrorField, PROVIDER_CONTENT_FILTER_REASON } from './ai-sdk-failure'
import { redactSecrets } from '@/shared/security/sentry-sanitize'
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

const TASK_DEADLINE_MESSAGES = new Set([
  'The authorized run deadline is exhausted.',
  'The authorized task deadline is exhausted.',
  'Harness deadline reached while waiting.',
  'The explicit harness task deadline was reached while waiting.',
])

const AUTHORIZATION_MESSAGES = [
  'This native tool is no longer authorized.',
  'This native action requires fresh approval.',
  'This personal action requires fresh approval.',
  'This native action became approval-required before execution.',
  'The surface binding or agent authorization changed.',
  'Surface workspace authority changed.',
  'Surface conversation ownership changed.',
  'Automation run is no longer authorized.',
  'Automation source authorization changed.',
  'The bound automation agent is no longer available.',
  'Personal harness delivery ownership has changed.',
  'Native root run is no longer available.',
  'Native parent run is no longer available.',
]

/** Prefixes: the model itself can no longer serve this run, whatever the provider says. */
const MODEL_UNAVAILABLE_MESSAGES = [
  'This hosted model is retired',
  'The output limit exceeds the selected model capacity.',
  'The model does not match this harness spending mode.',
  'Paid model execution requires workspace funding or external credentials.',
]

export type HarnessFailureCause = {
  name: string
  message?: string
  code?: string
  /** The provider's error type label, e.g. Anthropic's `api_error`. Never its message. */
  providerType?: string
  statusCode?: number
}

const PROVIDER_ERROR_TYPE = /^[a-z][a-z0-9_.-]{0,63}$/i

/**
 * The provider's own error type label from a streamed error event (Anthropic
 * `{ type: 'error', error: { type, message } }`, kept by the AI SDK as `type`).
 * A fixed vocabulary, so it is safe to log and classify; free text is dropped.
 */
export function providerErrorType(error: unknown): string | undefined {
  if (readErrorField(error, 'name') !== 'AI_StreamProviderError') return undefined
  const data = readErrorField(error, 'data')
  for (const value of [readErrorField(error, 'type'), readErrorField(readErrorField(data, 'error'), 'type'), readErrorField(data, 'type')]) {
    if (typeof value === 'string' && value !== 'error' && PROVIDER_ERROR_TYPE.test(value)) return value
  }
  return undefined
}

const STREAM_PROVIDER_ERROR_CODES: Readonly<Record<string, HarnessDiagnosticCode>> = {
  overloaded_error: 'PROVIDER_UNAVAILABLE',
  api_error: 'PROVIDER_UNAVAILABLE',
  server_error: 'PROVIDER_UNAVAILABLE',
  timeout_error: 'PROVIDER_TIMEOUT',
  rate_limit_error: 'PROVIDER_RATE_LIMIT',
  authentication_error: 'PROVIDER_ACCOUNT',
  permission_error: 'PROVIDER_ACCOUNT',
  billing_error: 'PROVIDER_ACCOUNT',
  invalid_request_error: 'PROVIDER_REQUEST_INVALID',
  not_found_error: 'PROVIDER_REQUEST_INVALID',
  request_too_large: 'PROVIDER_REQUEST_INVALID',
}

const MAX_CAUSE_MESSAGE = 300

function oneLine(value: string): string {
  return redactSecrets(value.replace(/\s+/g, ' ').trim()).slice(0, MAX_CAUSE_MESSAGE)
}

/**
 * The error chain behind a stopped task, for server logs only. Our own errors
 * keep their message; provider errors keep only the authored description, never
 * raw provider text. Bounded, single-line and secret-redacted.
 */
export function describeHarnessFailureCause(error: unknown): HarnessFailureCause[] {
  const chain: HarnessFailureCause[] = []
  const seen = new Set<object>()
  let current = error
  while (chain.length < 4 && current !== undefined && current !== null) {
    if (typeof current !== 'object') {
      chain.push({ name: typeof current, message: oneLine(String(current)) })
      break
    }
    if (seen.has(current)) break
    seen.add(current)
    const name = readErrorField(current, 'name')
    const statusCode = readErrorField(current, 'statusCode')
    const data = readErrorField(current, 'data')
    const code = readErrorField(data, 'code') ?? readErrorField(current, 'code')
    const fromProvider = (typeof name === 'string' && name.startsWith('AI_')) || typeof statusCode === 'number'
    const providerType = providerErrorType(current)
    const text = fromProvider
      ? describeAISDKFailure(current)
      : readErrorField(data, 'message') ?? readErrorField(current, 'message')
    chain.push({
      name: typeof name === 'string' && name ? name.slice(0, 64) : 'Object',
      ...(typeof text === 'string' && text.trim() ? { message: oneLine(text) } : {}),
      ...(typeof code === 'string' ? { code: code.slice(0, 64) } : {}),
      ...(providerType ? { providerType } : {}),
      ...(typeof statusCode === 'number' ? { statusCode } : {}),
    })
    current = readErrorField(current, 'cause')
  }
  return chain
}

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
    // The provider sent an error event mid-stream without an HTTP status. Its type
    // label says why; any other stream error is still the provider's, not Overlay's.
    if (currentName === 'AI_StreamProviderError') {
      const providerType = providerErrorType(current)
      return (providerType ? STREAM_PROVIDER_ERROR_CODES[providerType] : undefined) ?? 'PROVIDER_UNAVAILABLE'
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
  if (TASK_DEADLINE_MESSAGES.has(message)) {
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
    'Native delivery ownership changed.', ...AUTHORIZATION_MESSAGES].includes(message)) {
    code = 'AUTHORIZATION_REVOKED'
  } else if (MODEL_UNAVAILABLE_MESSAGES.some(prefix => message.startsWith(prefix))) {
    code = 'MODEL_UNAVAILABLE'
    stage = 'model'
  } else if (message === 'Harness backend is unavailable.') {
    code = 'BACKEND_UNAVAILABLE'
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
  // Nothing more specific is known: this is an Overlay fault. Its cause chain is
  // logged under the diagnostic ID (reportHarnessFailure), so it stays traceable.
  if (code === 'UNKNOWN') code = 'INTERNAL_ERROR'
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

/**
 * One server log line per stopped task, keyed by the diagnostic ID people see,
 * so a log search for that ID finds what actually went wrong. Carries no prompt,
 * output or raw provider text; credentials are redacted.
 */
export function logHarnessFailure(runId: string, diagnostic: HarnessDiagnostic, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[harness] task stopped ${diagnostic.diagnosticId} ${JSON.stringify({
    diagnosticId: diagnostic.diagnosticId,
    code: diagnostic.code,
    stage: diagnostic.stage,
    operationId: diagnostic.operationId,
    runId,
    cause: describeHarnessFailureCause(error),
  })}`)
}
