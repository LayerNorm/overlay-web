import test from 'node:test'
import assert from 'node:assert/strict'
import { readNativeAgentApproval } from './native-agent-approval'

const approval = {
  runId: 'run-1', conversationId: 'conversation-1', userId: 'user-1', token: 'hook-1', requestedAt: 100,
  requests: [{ approvalId: 'approval-1', toolCallId: 'call-1', toolName: 'computer_exec', input: { command: 'pwd' } }],
}

test('pending native approval projection preserves exact call arguments', () => {
  assert.deepEqual(readNativeAgentApproval(approval), approval)
})

test('malformed native approval projections do not render actionable cards', () => {
  for (const value of [null, [], {}, { ...approval, token: '' }, { ...approval, requestedAt: NaN },
    { ...approval, requests: [] }, { ...approval, requests: [{ toolName: 'computer_exec' }] }]) {
    assert.equal(readNativeAgentApproval(value), undefined)
  }
})
