import { expect, test, vi } from 'vitest'
import { APICallError, StreamProviderError } from 'ai'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import {
  HarnessPersistenceError, harnessDiagnosticForFailure, harnessDiagnosticTerminalError, INTERRUPTED_MODEL_CALL_PROVIDER,
  describeHarnessFailureCause, logHarnessFailure, stableHarnessDiagnosticId,
} from './harness-diagnostics'

function snapshot(overrides: Partial<HarnessSnapshot> = {}): HarnessSnapshot {
  return {
    runId: 'root',
    rootRunId: 'root',
    depth: 0,
    goal: 'Complete the task.',
    constraints: [],
    policy: {
      actorUserId: 'user',
      allowedToolIds: [],
      requiresPlan: false,
      deadlineAt: Date.now() + 60_000,
      maxCostMicros: 0,
      executionPolicyVersion: 2, spendingMode: 'none',
      workspaceId: 'workspace',
    },
    status: 'running',
    revision: 4,
    progressRevision: 0,
    planRevision: 0,
    plan: [],
    evidence: [],
    children: [],
    workingSummary: '',
    continuations: 0,
    lastContinuationProgressRevision: 0,
    stalledContinuations: 0,
    usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
    updatedAt: 1,
    ...overrides,
  }
}

test('an unrecognized failure is an internal error, never UNKNOWN, and keeps its text out of the message', () => {
  const diagnostic = harnessDiagnosticForFailure('root', snapshot(), new Error('budget was rejected'), 'model')
  expect(diagnostic).toMatchObject({ code: 'INTERNAL_ERROR', retryability: 'user_action' })
  expect(harnessDiagnosticTerminalError(diagnostic)).toMatchObject({
    retryable: true,
    message: expect.stringContaining('Diagnostic ID:'),
  })
  expect(harnessDiagnosticTerminalError(diagnostic).message).not.toContain('budget was rejected')
})

const openDispatch = {
  modelReservation: { id: 'model:7', maxCostMicros: 0, dispatch: { modelId: 'fixture/model', billingReservationId: null } },
} satisfies Partial<HarnessSnapshot>

test('an open dispatch with no known cause becomes MODEL_OUTCOME_UNKNOWN with plain copy', () => {
  const diagnostic = harnessDiagnosticForFailure('root', snapshot(openDispatch), new Error('stream closed'), 'model')
  expect(diagnostic).toMatchObject({
    code: 'MODEL_OUTCOME_UNKNOWN',
    stage: 'model',
    operationId: 'model:7',
    retryability: 'user_action',
    safeMessage: 'The model connection dropped before the response finished.',
    nextAction: 'Send your message again.',
  })
  expect(harnessDiagnosticTerminalError(diagnostic)).toMatchObject({
    retryable: true,
    message: `The model connection dropped before the response finished. Send your message again. Diagnostic ID: ${diagnostic.diagnosticId}`,
  })
})

test('the real provider cause is classified before an open dispatch', () => {
  const status = (statusCode: number) => new APICallError({
    message: 'provider failed', url: 'https://provider.invalid', requestBodyValues: {}, statusCode,
  })
  const open = snapshot(openDispatch)
  expect(harnessDiagnosticForFailure('root', open, status(429), 'model').code).toBe('PROVIDER_RATE_LIMIT')
  expect(harnessDiagnosticForFailure('root', open, status(503), 'model').code).toBe('PROVIDER_UNAVAILABLE')
  expect(harnessDiagnosticForFailure('root', open, status(401), 'model').code).toBe('PROVIDER_ACCOUNT')
  expect(harnessDiagnosticForFailure('root', open, status(400), 'model').code).toBe('PROVIDER_REQUEST_INVALID')
  expect(harnessDiagnosticForFailure('root', open, Object.assign(new Error('slow'), { name: 'TimeoutError' }), 'model').code)
    .toBe('PROVIDER_TIMEOUT')
  expect(harnessDiagnosticForFailure('root', open, { name: 'AI_APICallError', statusCode: 429, message: 'stripped' }, 'model').code)
    .toBe('PROVIDER_RATE_LIMIT')
  expect(harnessDiagnosticForFailure('root', open, new Error('The workspace budget is under 2%.'), 'model').code)
    .toBe('WORKSPACE_FUNDS')
  expect(harnessDiagnosticForFailure('root', open, new Error('Native harness permissions were revoked.'), 'model').code)
    .toBe('AUTHORIZATION_REVOKED')
})

test('an interrupted call that exhausted its retries stays MODEL_OUTCOME_UNKNOWN after its dispatch closes', () => {
  const interrupted = snapshot({
    latestReceipt: {
      id: 'model:7', modelId: 'fixture/model', provider: INTERRUPTED_MODEL_CALL_PROVIDER,
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      contextWindow: null, costMicros: 0, costSource: 'catalog', responseFailure: 'provider_error',
    },
    modelRecovery: { receiptId: 'model:7', modelId: 'fixture/model', code: 'provider_error', attempt: 4, firstFailureAt: 1, nextRetryAt: 2 },
  })
  expect(harnessDiagnosticForFailure('root', interrupted, new Error('stream closed'), 'model'))
    .toMatchObject({ code: 'MODEL_OUTCOME_UNKNOWN', operationId: 'model:7' })
  expect(harnessDiagnosticForFailure('root', { ...interrupted, modelRecovery: undefined }, new Error('stream closed'), 'model').code)
    .toBe('INTERNAL_ERROR')
})

test('failure logs are keyed by diagnostic ID and carry the cause chain', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const cause = Object.assign(new Error('Delegate an unfinished unassigned milestone.'), {
    name: 'FatalError', cause: new Error('token sk-live-abcdefghijklmnopqrstuvwxyz0123'),
  })
  const diagnostic = harnessDiagnosticForFailure('root', snapshot(), cause, 'model')
  logHarnessFailure('root', diagnostic, cause)
  expect(error).toHaveBeenCalledOnce()
  const line = String(error.mock.calls[0]?.[0])
  expect(line.startsWith(`[harness] task stopped ${diagnostic.diagnosticId} `)).toBe(true)
  expect(JSON.parse(line.slice(line.indexOf('{')))).toMatchObject({
    diagnosticId: diagnostic.diagnosticId, code: 'INTERNAL_ERROR', stage: 'model', runId: 'root',
    cause: [{ name: 'FatalError', message: 'Delegate an unfinished unassigned milestone.' }, { name: 'Error' }],
  })
  expect(line).not.toContain('abcdefghijklmnopqrstuvwxyz0123')
  error.mockRestore()
})

test('provider causes keep the authored description, never raw provider text', () => {
  const apiError = new APICallError({
    message: 'raw provider body echoing the prompt', url: 'https://provider.invalid', requestBodyValues: {}, statusCode: 503,
  })
  const [cause] = describeHarnessFailureCause(apiError)
  expect(cause).toMatchObject({ name: 'AI_APICallError', statusCode: 503 })
  expect(JSON.stringify(cause)).not.toContain('raw provider body')
})

// What an Anthropic `error` event becomes after the AI SDK normalizes it.
function anthropicStreamError(type: string) {
  return new StreamProviderError({
    message: 'raw provider text echoing the prompt', type,
    data: { type, message: 'raw provider text echoing the prompt' },
  })
}

test('a mid-stream provider error logs its type label, never its text', () => {
  const [cause] = describeHarnessFailureCause(anthropicStreamError('api_error'))
  expect(cause).toMatchObject({ name: 'AI_StreamProviderError', providerType: 'api_error' })
  expect(JSON.stringify(cause)).not.toContain('raw provider text')
})

test.each([
  ['api_error', 'PROVIDER_UNAVAILABLE'],
  ['overloaded_error', 'PROVIDER_UNAVAILABLE'],
  ['rate_limit_error', 'PROVIDER_RATE_LIMIT'],
  ['timeout_error', 'PROVIDER_TIMEOUT'],
  ['billing_error', 'PROVIDER_ACCOUNT'],
  ['invalid_request_error', 'PROVIDER_REQUEST_INVALID'],
  ['an_unlisted_error', 'PROVIDER_UNAVAILABLE'],
] as const)('a mid-stream %s is a provider failure, not an internal error', (type, code) => {
  expect(harnessDiagnosticForFailure('root', snapshot(), anthropicStreamError(type), 'model').code).toBe(code)
})

test('a mid-stream provider error stays classified after durable transport strips its prototype', () => {
  const stripped = { name: 'AI_StreamProviderError', message: 'raw', type: 'rate_limit_error', data: { type: 'rate_limit_error' } }
  expect(harnessDiagnosticForFailure('root', snapshot(), stripped, 'model').code).toBe('PROVIDER_RATE_LIMIT')
  const typeless = { name: 'AI_StreamProviderError', message: 'raw' }
  expect(harnessDiagnosticForFailure('root', snapshot(), typeless, 'model').code).toBe('PROVIDER_UNAVAILABLE')
  expect(describeHarnessFailureCause({ name: 'AI_StreamProviderError', type: 'not a label!' })[0]).not.toHaveProperty('providerType')
})

test('a model the server no longer offers is reported as a model problem, not lost authorization', () => {
  for (const message of ['The native model is no longer allowed by server policy.', 'The model is no longer allowed by server policy.']) {
    const diagnostic = harnessDiagnosticForFailure('root', snapshot(), new Error(message), 'model')
    expect(diagnostic.code).toBe('MODEL_UNAVAILABLE')
    expect(diagnostic.nextAction).toBe('Choose another model and send your message again.')
  }
})

test('fatal model and backend failures are classified instead of unknown', () => {
  expect(harnessDiagnosticForFailure('root', snapshot(), new Error('This hosted model is retired. Choose a supported paid model.'), 'model').code)
    .toBe('MODEL_UNAVAILABLE')
  expect(harnessDiagnosticForFailure('root', snapshot(), new Error('Harness backend is unavailable.'), 'model').code)
    .toBe('BACKEND_UNAVAILABLE')
  expect(harnessDiagnosticForFailure('root', snapshot(), new Error('This native action requires fresh approval.'), 'tool').code)
    .toBe('AUTHORIZATION_REVOKED')
  expect(harnessDiagnosticForFailure('root', snapshot(), new Error('The explicit harness task deadline was reached while waiting.'), 'model').code)
    .toBe('TASK_DEADLINE')
})

test('verified provider status and exact task policy failures use authored safe copy', () => {
  const apiError = new APICallError({
    message: 'provider throttled', url: 'https://provider.invalid', requestBodyValues: {}, statusCode: 429,
  })
  expect(harnessDiagnosticForFailure('root', snapshot(), apiError, 'model').code).toBe('PROVIDER_RATE_LIMIT')
  expect(harnessDiagnosticForFailure('root', snapshot(), new Error('The authorized run deadline is exhausted.'), 'model').code)
    .toBe('TASK_DEADLINE')
  expect(harnessDiagnosticForFailure('root', snapshot(), new Error('Harness deadline reached while waiting.'), 'model').code)
    .toBe('TASK_DEADLINE')
  expect(harnessDiagnosticForFailure('root', snapshot(), new Error('The workspace budget is under 2%.'), 'model').code)
    .toBe('WORKSPACE_FUNDS')
  expect(harnessDiagnosticForFailure('root', snapshot(), new Error('Model budget reservation declined: insufficient_budget'), 'model').code)
    .toBe('WORKSPACE_FUNDS')
  expect(harnessDiagnosticForFailure('root', snapshot(), new Error('Model budget reservation declined: insufficient_credits'), 'model').code)
    .toBe('WORKSPACE_FUNDS')
})

test.each([
  'Harness request is not owned by an active execution.',
  'HARNESS_EXECUTION_NOT_OWNED',
  'Native harness execution is no longer authorized.',
  'Native delivery execution changed.',
  'Personal harness resource access has changed.',
])('run bookkeeping fault %s is an Overlay error, not lost authorization', message => {
  // Even with a model call in flight, so it never reads as a dropped model connection.
  const diagnostic = harnessDiagnosticForFailure('root', snapshot({
    modelReservation: { id: 'model:1', dispatch: { receiptId: 'receipt' } },
  } as never), new Error(message), 'model')
  expect(diagnostic).toMatchObject({ code: 'INTERNAL_ERROR', retryability: 'user_action' })
  expect(harnessDiagnosticTerminalError(diagnostic).message).not.toContain(message)
  expect(harnessDiagnosticTerminalError(diagnostic).message).not.toMatch(/authorization|membership/)
})

test.each([
  'Personal harness execution is not authorized to continue.',
  'Native workspace identity changed.',
  'The API key that authorized this run is no longer permitted.',
])('exact authorization failure %s is classified without exposing its detail', message => {
  const diagnostic = harnessDiagnosticForFailure('root', snapshot(), new Error(message), 'model')
  expect(diagnostic).toMatchObject({ code: 'AUTHORIZATION_REVOKED', retryability: 'user_action' })
  expect(harnessDiagnosticTerminalError(diagnostic).message).not.toContain(message)
})

test.each([
  ['route_capacity', 'PROVIDER_RATE_LIMIT'],
  ['route_unavailable', 'PROVIDER_UNAVAILABLE'],
  ['route_interrupted', 'PROVIDER_TIMEOUT'],
] as const)('persisted zero-cost %s rejection survives lost caught-error details', (rejectionReason, code) => {
  const diagnostic = harnessDiagnosticForFailure('root', snapshot({
    latestReceipt: {
      id: 'model:8', modelId: 'openrouter/free', provider: 'overlay-free-router',
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0,
      cacheWriteTokens: 0, contextWindow: null, costMicros: 0, costSource: 'catalog',
      rejectionReason,
    },
  }), new Error('Serialized provider error lost typed details.'), 'model')
  expect(diagnostic.code).toBe(code)
})

test('an unrecognized final failure is an internal error that does not echo its details', () => {
  const diagnostic = harnessDiagnosticForFailure('root', snapshot({
    status: 'failed',
    terminalReason: 'untrusted provider details',
  }), new Error('untrusted provider details'), 'delivery')
  expect(diagnostic).toMatchObject({ code: 'INTERNAL_ERROR', stage: 'delivery', retryability: 'user_action' })
  expect(harnessDiagnosticTerminalError(diagnostic)).toMatchObject({ retryable: true })
  expect(harnessDiagnosticTerminalError(diagnostic).message).not.toContain('untrusted provider details')
})

test('an earlier progress diagnostic does not label a different terminal failure', () => {
  const earlier = harnessDiagnosticForFailure('root', snapshot(), new Error('budget was rejected'), 'model')
  const current = harnessDiagnosticForFailure('root', snapshot({
    diagnostic: earlier,
    terminalReason: 'unknown failure',
  }), new Error('unknown failure'), 'delivery')
  expect(current.code).toBe('INTERNAL_ERROR')
  const terminalSnapshot = snapshot({ status: 'failed', diagnostic: earlier })
  expect(harnessDiagnosticForFailure('root', terminalSnapshot, new Error('different'), 'delivery')).toBe(earlier)
  const persistence = harnessDiagnosticForFailure('root', snapshot(), new HarnessPersistenceError(), 'persistence')
  expect(harnessDiagnosticForFailure('root', snapshot({
    status: 'completed',
    diagnostic: persistence,
  }), new Error('a later unrelated error'), 'delivery')).toBe(persistence)
})

test('ambiguous tool exceptions use reconciliation instead of an automatic retry', () => {
  const diagnostic = harnessDiagnosticForFailure('root', snapshot(), {
    code: 'HARNESS_TOOL_OUTCOME_UNKNOWN',
    operationId: 'call-7',
  }, 'tool')
  expect(diagnostic).toMatchObject({
    code: 'TOOL_OUTCOME_UNKNOWN',
    stage: 'tool',
    operationId: 'call-7',
    retryability: 'reconcile',
  })
  expect(harnessDiagnosticTerminalError(diagnostic).retryable).toBe(false)
})

test('diagnostic IDs are stable short correlations, not raw operation arguments', () => {
  const first = stableHarnessDiagnosticId('root', 'model:7', 4)
  expect(first).toMatch(/^hd_[a-z0-9]+$/)
  expect(first).toBe(stableHarnessDiagnosticId('root', 'model:7', 4))
  expect(first).not.toContain('model:7')
})

test.each([
  [400, 'PROVIDER_REQUEST_INVALID'],
  [404, 'PROVIDER_REQUEST_INVALID'],
  [413, 'PROVIDER_REQUEST_INVALID'],
  [401, 'PROVIDER_ACCOUNT'],
  [402, 'PROVIDER_ACCOUNT'],
  [403, 'PROVIDER_ACCOUNT'],
] as const)('a provider HTTP %i rejection is %s, typed or after transport strips the prototype', (statusCode, code) => {
  const apiError = new APICallError({
    message: 'This subscription service supports text-only requests',
    url: 'https://provider.invalid', requestBodyValues: {}, statusCode,
  })
  const typed = harnessDiagnosticForFailure('root', snapshot(), apiError, 'model')
  expect(typed).toMatchObject({ code, retryability: 'user_action' })
  expect(harnessDiagnosticTerminalError(typed).message).not.toContain('text-only')
  const stripped = { name: 'AI_APICallError', message: apiError.message, statusCode }
  expect(harnessDiagnosticForFailure('root', snapshot(), { name: 'WorkflowError', cause: stripped }, 'model').code).toBe(code)
})
