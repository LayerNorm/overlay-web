import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  harnessApprovalContinuationMessages,
  pendingHarnessApprovals,
} from './approvals'

test('pendingHarnessApprovals extracts the suspended turn\'s pending set', () => {
  const approvals = pendingHarnessApprovals({
    pendingToolApprovals: [
      {
        approvalId: 'ap-1',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: '{"command":"rm -rf /tmp/x"}',
        kind: 'builtin',
      },
      {
        approvalId: 'ap-2',
        toolCallId: 'call-2',
        toolName: 'writeFile',
        input: { path: '/tmp/y' },
        providerExecuted: true,
      },
      // Malformed entries are dropped rather than poisoning the card.
      { approvalId: 7 },
      null,
    ],
  })
  assert.deepEqual(approvals, [
    {
      approvalId: 'ap-1',
      toolCallId: 'call-1',
      toolName: 'bash',
      input: '{"command":"rm -rf /tmp/x"}',
    },
    {
      approvalId: 'ap-2',
      toolCallId: 'call-2',
      toolName: 'writeFile',
      input: { path: '/tmp/y' },
      providerExecuted: true,
    },
  ])
})

test('pendingHarnessApprovals is empty for absent or malformed handles', () => {
  assert.deepEqual(pendingHarnessApprovals(undefined), [])
  assert.deepEqual(pendingHarnessApprovals({}), [])
  assert.deepEqual(pendingHarnessApprovals({ pendingToolApprovals: 'nope' }), [])
  assert.deepEqual(pendingHarnessApprovals({ pendingToolApprovals: [{ toolName: 'x' }] }), [])
})

test('harnessApprovalContinuationMessages synthesizes the approval-response turn', () => {
  const messages = harnessApprovalContinuationMessages([
    { approvalId: 'ap-1', toolCallId: 'call-1', toolName: 'bash', input: '{"command":"ls"}' },
    { approvalId: 'ap-2', toolCallId: 'call-2', toolName: 'writeFile', input: { path: '/y' }, providerExecuted: true },
  ], { approved: false, reason: 'Not this time' })

  assert.equal(messages.length, 2)
  const [assistant, tool] = messages as [
    { role: string; content: Array<Record<string, unknown>> },
    { role: string; content: Array<Record<string, unknown>> },
  ]
  assert.equal(assistant.role, 'assistant')
  // Each pending approval contributes a tool-call + tool-approval-request pair.
  assert.deepEqual(assistant.content, [
    { type: 'tool-call', toolCallId: 'call-1', toolName: 'bash', input: { command: 'ls' } },
    { type: 'tool-approval-request', approvalId: 'ap-1', toolCallId: 'call-1' },
    { type: 'tool-call', toolCallId: 'call-2', toolName: 'writeFile', input: { path: '/y' } },
    { type: 'tool-approval-request', approvalId: 'ap-2', toolCallId: 'call-2' },
  ])
  assert.equal(tool.role, 'tool')
  assert.deepEqual(tool.content, [
    { type: 'tool-approval-response', approvalId: 'ap-1', approved: false, reason: 'Not this time' },
    {
      type: 'tool-approval-response',
      approvalId: 'ap-2',
      approved: false,
      reason: 'Not this time',
      providerExecuted: true,
    },
  ])
})

test('harnessApprovalContinuationMessages omits reason and providerExecuted when absent', () => {
  const [, tool] = harnessApprovalContinuationMessages(
    [{ approvalId: 'ap-1', toolCallId: 'call-1', toolName: 'bash', input: 'not-json' }],
    { approved: true },
  ) as [unknown, { content: Array<Record<string, unknown>> }]
  assert.deepEqual(tool.content, [
    { type: 'tool-approval-response', approvalId: 'ap-1', approved: true },
  ])
})
