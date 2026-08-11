import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeUsageReconciliationResolution } from './usage-reconciliation'

const evidence = {
  reason: 'Provider confirms that no request was accepted.',
  reference: 'provider-request:req_123',
  source: 'provider-api',
}

test('reconciliation release requires durable evidence and forbids an actual charge', () => {
  assert.deepEqual(normalizeUsageReconciliationResolution({
    evidence,
    reservedCents: 25,
    resolution: 'release',
  }), { evidence, resolution: 'release' })

  assert.throws(() => normalizeUsageReconciliationResolution({
    actualCostCents: 0,
    evidence,
    reservedCents: 25,
    resolution: 'release',
  }), /release_resolution_cannot_include_actual_cost/)
})

test('reconciliation finalization requires a bounded non-negative actual charge', () => {
  assert.deepEqual(normalizeUsageReconciliationResolution({
    actualCostCents: 20,
    evidence,
    reservedCents: 25,
    resolution: 'finalize',
  }), { actualCostCents: 20, evidence, resolution: 'finalize' })

  assert.throws(() => normalizeUsageReconciliationResolution({
    actualCostCents: 26,
    evidence,
    reservedCents: 25,
    resolution: 'finalize',
  }), /actual_cost_exceeds_reservation/)
})

test('reconciliation rejects blank evidence fields', () => {
  assert.throws(() => normalizeUsageReconciliationResolution({
    evidence: { ...evidence, reference: '   ' },
    reservedCents: 25,
    resolution: 'release',
  }), /reconciliation_evidence_reference_required/)
})
