import assert from 'node:assert/strict'
import test from 'node:test'
import { automationApprovalToken as buildApprovalToken, automationRunTurnId } from './run-identity'

test('buildApprovalToken produces deterministic token for same inputs', () => {
  const token1 = buildApprovalToken('auto_001', 1700000000000)
  const token2 = buildApprovalToken('auto_001', 1700000000000)
  assert.equal(token1, token2)
})

test('buildApprovalToken produces different tokens for different automation IDs', () => {
  const token1 = buildApprovalToken('auto_001', 1700000000000)
  const token2 = buildApprovalToken('auto_002', 1700000000000)
  assert.notEqual(token1, token2)
})

test('buildApprovalToken produces different tokens for different timestamps', () => {
  const token1 = buildApprovalToken('auto_001', 1700000000000)
  const token2 = buildApprovalToken('auto_001', 1700000000001)
  assert.notEqual(token1, token2)
})

test('buildApprovalToken includes automation ID and timestamp', () => {
  const token = buildApprovalToken('auto_001', 1700000000000)
  assert.ok(token.includes('auto_001'))
  assert.ok(token.includes('1700000000000'))
  assert.ok(token.startsWith('automation-approval:'))
})

test('an automation run has exactly one turn ID, derived from its run ID', () => {
  assert.equal(automationRunTurnId('run_001'), 'automation-run:run_001')
  assert.equal(automationRunTurnId('run_001'), automationRunTurnId('run_001'))
  assert.notEqual(automationRunTurnId('run_001'), automationRunTurnId('run_002'))
})
