import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HARNESS_RESOURCE_TIME_GRANTS_MS,
  MAX_HARNESS_RESOURCE_SPEND_MICROS,
  calculateHarnessResourceGrantReceipt,
  type HarnessResourceRequest,
} from './harness-resource'

const request: HarnessResourceRequest = {
  token: 'resource-token',
  runId: 'root',
  rootRunId: 'root',
  workflowRunId: 'workflow',
  policyRevision: 2,
  reason: 'model_spend',
  currentMaxCostMicros: 10,
  usedCostMicros: 4,
  reservedCostMicros: 3,
  requiredCostMicros: 5,
  deadlineAt: 1_000,
  requestedAt: 900,
}

test('model grants require safe integer micros and only change the spend cap', () => {
  const receipt = calculateHarnessResourceGrantReceipt({
    request,
    grant: { kind: 'model_spend', newMaxCostMicros: 12 },
    grantedAt: 950,
  })
  assert.equal(receipt.maxCostMicros, 12)
  assert.equal(receipt.deadlineAt, request.deadlineAt)
  assert.equal(receipt.policyRevisionBefore, 2)
  assert.equal(receipt.policyRevisionAfter, 3)
  for (const invalid of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, MAX_HARNESS_RESOURCE_SPEND_MICROS + 1]) {
    assert.throws(() => calculateHarnessResourceGrantReceipt({
      request,
      grant: { kind: 'model_spend', newMaxCostMicros: invalid },
      grantedAt: 950,
    }))
  }
})

test('model grants cannot exceed the maximum or leave forecast commitments uncovered', () => {
  assert.equal(MAX_HARNESS_RESOURCE_SPEND_MICROS, 100_000_000)
  assert.throws(() => calculateHarnessResourceGrantReceipt({
    request: { ...request, usedCostMicros: Number.MAX_SAFE_INTEGER },
    grant: { kind: 'model_spend', newMaxCostMicros: 20 },
    grantedAt: 950,
  }), /safe-integer/)
  assert.throws(() => calculateHarnessResourceGrantReceipt({
    request,
    grant: { kind: 'model_spend', newMaxCostMicros: 11 },
    grantedAt: 950,
  }), /cover current commitments/)
})

test('time grants accept only exact durations and do not change the spend cap', () => {
  assert.deepEqual(HARNESS_RESOURCE_TIME_GRANTS_MS, [3_600_000, 86_400_000, 604_800_000])
  const receipt = calculateHarnessResourceGrantReceipt({
    request: { ...request, reason: 'time' },
    grant: { kind: 'time', durationMs: 3_600_000 },
    grantedAt: 1_500,
  })
  assert.equal(receipt.maxCostMicros, request.currentMaxCostMicros)
  assert.equal(receipt.deadlineAt, 3_601_500)
  assert.throws(() => calculateHarnessResourceGrantReceipt({
    request: { ...request, reason: 'time' },
    grant: { kind: 'time', durationMs: 3_600_001 },
    grantedAt: 950,
  }), /unsupported/)
})
