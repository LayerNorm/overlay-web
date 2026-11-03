import { expect, test } from 'vitest'
import { createHarnessToolApprovals, sameHarnessApprovalRequests } from './tool-approvals'

const request = { approvalId: 'approval', toolCallId: 'call', toolName: 'write', input: { path: 'file', content: 'approved' } }
const decisions = [{ approvalId: 'approval', approved: true }]

test.each([
  { approvalId: 'different' }, { toolCallId: 'different' }, { toolName: 'different' },
  { input: { path: 'file', content: 'different' } },
])('persisted approval identity rejects changed fields: %j', changed => {
  expect(sameHarnessApprovalRequests([request], [{ ...request, ...changed }])).toBe(false)
})

test('persisted approval comparison preserves array order and request cardinality', () => {
  const original = { ...request, input: { steps: ['first', 'second'] } }
  expect(sameHarnessApprovalRequests([original], [{ ...original, input: { steps: ['second', 'first'] } }])).toBe(false)
  expect(sameHarnessApprovalRequests([original], [original, original])).toBe(false)
})

test('authenticated approval is exact, single-use and independent of object key order', () => {
  const ledger = createHarnessToolApprovals()
  expect(ledger.consume('write', 'call', request.input)).toBe(false)
  ledger.record([request], decisions)
  expect(ledger.consume('write', 'call', { content: 'approved', path: 'file' })).toBe(true)
  expect(ledger.consume('write', 'call', request.input)).toBe(false)
})

test('a restored trusted grant is consumed once', () => {
  const original = createHarnessToolApprovals()
  original.record([request], decisions)
  const restored = createHarnessToolApprovals(original.snapshot())
  expect(restored.consume('write', 'call', request.input)).toBe(true)
  expect(restored.consume('write', 'call', request.input)).toBe(false)
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
