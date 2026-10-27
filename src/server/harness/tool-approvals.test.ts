import { expect, test } from 'vitest'
import { createHarnessToolApprovals } from './tool-approvals'

const request = { approvalId: 'approval', toolCallId: 'call', toolName: 'write', input: { path: 'file', content: 'approved' } }
const decisions = [{ approvalId: 'approval', approved: true }]

test('authenticated approval is exact, single-use and independent of object key order', () => {
  const ledger = createHarnessToolApprovals()
  expect(ledger.consume('write', 'call', request.input)).toBe(false)
  ledger.record([request], decisions)
  expect(ledger.consume('write', 'call', { content: 'approved', path: 'file' })).toBe(true)
  expect(ledger.consume('write', 'call', request.input)).toBe(false)
})

test('changed arguments, tool names, denied decisions and other runs cannot reuse approval', () => {
  const ledger = createHarnessToolApprovals()
  ledger.record([request], decisions)
  expect(ledger.consume('write', 'call', { ...request.input, content: 'different' })).toBe(false)
  ledger.record([request], decisions)
  expect(ledger.consume('delete', 'call', request.input)).toBe(false)
  ledger.record([request], [{ approvalId: 'approval', approved: false }])
  expect(ledger.consume('write', 'call', request.input)).toBe(false)
  ledger.record([request], decisions)
  expect(createHarnessToolApprovals().consume('write', 'call', request.input)).toBe(false)
})

test('ambiguous call identities fail closed and a new approval batch clears old grants', () => {
  const ledger = createHarnessToolApprovals()
  expect(() => ledger.record([request, { ...request, approvalId: 'other' }], decisions)).toThrow(/unique/)
  ledger.record([request], decisions)
  ledger.record([{ ...request, toolCallId: 'next', approvalId: 'next' }], [{ approvalId: 'next', approved: false }])
  expect(ledger.consume('write', 'call', request.input)).toBe(false)
})
