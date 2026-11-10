import { expect, test } from 'vitest'
import { APICallError } from 'ai'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import {
  HarnessPersistenceError, harnessDiagnosticForFailure, harnessDiagnosticTerminalError, stableHarnessDiagnosticId,
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
      maxParallelChildren: 0,
      maxDepth: 0,
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

test('generic budget-like text remains UNKNOWN and is not retryable', () => {
  const diagnostic = harnessDiagnosticForFailure('root', snapshot(), new Error('budget was rejected'), 'model')
  expect(diagnostic).toMatchObject({ code: 'UNKNOWN', retryability: 'reconcile' })
  expect(harnessDiagnosticTerminalError(diagnostic)).toMatchObject({
    retryable: false,
    message: expect.stringContaining('Diagnostic ID:'),
  })
  expect(harnessDiagnosticTerminalError(diagnostic).message).not.toContain('budget was rejected')
})

test('only an unresolved bound model dispatch becomes MODEL_OUTCOME_UNKNOWN', () => {
  const diagnostic = harnessDiagnosticForFailure('root', snapshot({
    modelReservation: { id: 'model:7', maxCostMicros: 20, dispatch: { modelId: 'fixture/model', billingReservationId: 'billing-7' } },
  }), new Error('provider failed'), 'model')
  expect(diagnostic).toMatchObject({
    code: 'MODEL_OUTCOME_UNKNOWN',
    stage: 'model',
    operationId: 'model:7',
    retryability: 'reconcile',
  })
  expect(harnessDiagnosticTerminalError(diagnostic).retryable).toBe(false)
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
  expect(harnessDiagnosticForFailure('root', snapshot(), new Error('The authorized spending budget is exhausted.'), 'model').code)
    .toBe('TASK_SPEND_LIMIT')
  expect(harnessDiagnosticForFailure('root', snapshot(), new Error('Model budget reservation declined: insufficient_budget'), 'model').code)
    .toBe('WORKSPACE_FUNDS')
  expect(harnessDiagnosticForFailure('root', snapshot(), new Error('Model budget reservation declined: insufficient_credits'), 'model').code)
    .toBe('WORKSPACE_FUNDS')
})

test.each([
  'Harness request is not owned by an active execution.',
  'HARNESS_EXECUTION_NOT_OWNED',
  'Native harness execution is no longer authorized.',
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

test('unknown final failure has safe nonretryable reconciliation provenance', () => {
  const diagnostic = harnessDiagnosticForFailure('root', snapshot({
    status: 'failed',
    terminalReason: 'untrusted provider details',
  }), new Error('untrusted provider details'), 'delivery')
  expect(diagnostic).toMatchObject({ code: 'UNKNOWN', stage: 'delivery', retryability: 'reconcile' })
  expect(harnessDiagnosticTerminalError(diagnostic)).toMatchObject({ retryable: false })
  expect(harnessDiagnosticTerminalError(diagnostic).message).not.toContain('untrusted provider details')
})

test('an earlier progress diagnostic does not label a different terminal failure', () => {
  const earlier = harnessDiagnosticForFailure('root', snapshot(), new Error('budget was rejected'), 'model')
  const current = harnessDiagnosticForFailure('root', snapshot({
    diagnostic: earlier,
    terminalReason: 'unknown failure',
  }), new Error('unknown failure'), 'delivery')
  expect(current.code).toBe('UNKNOWN')
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
