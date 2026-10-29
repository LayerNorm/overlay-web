import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { shouldApplyRunSnapshot, toAgentRunResource } from './useAgentRunLifecycle'
import { useWorkApproval } from './useWorkApproval'

const approval = {
  token: 'approval-token',
  requestedAt: 100,
  requests: [{
    approvalId: 'approval-click',
    toolCallId: 'click-call',
    toolName: 'computer_browser',
    input: { action: 'click', ref: 'overlay-1', confirm: true },
  }],
}

const waitingRunDoc = {
  _id: 'run_1',
  _creationTime: 50,
  conversationId: 'conversation_1',
  status: 'waiting_for_approval',
  createdAt: 50,
  updatedAt: 100,
  approval,
}

test('Convex run projection preserves approval metadata', () => {
  assert.deepEqual(toAgentRunResource(waitingRunDoc)?.approval, approval)
  assert.equal(toAgentRunResource(waitingRunDoc)?.updatedAt, 100)
})

test('run snapshot merge applies newer and different runs but ignores stale same-id runs', () => {
  const current = { id: 'run_1', status: 'running' as const, updatedAt: 200 }
  assert.equal(shouldApplyRunSnapshot(current, { ...current, updatedAt: 201 }), true)
  assert.equal(shouldApplyRunSnapshot(current, { ...current, updatedAt: 199 }), false)
  assert.equal(shouldApplyRunSnapshot(current, { ...current, updatedAt: undefined }), false)
  assert.equal(shouldApplyRunSnapshot(current, { ...current, id: 'run_2', updatedAt: 1 }), true)
})

test('run snapshot merge preserves active runs when a null snapshot arrives', () => {
  for (const status of ['waiting_for_approval', 'waiting_for_input', 'waiting_for_children'] as const) {
    assert.equal(shouldApplyRunSnapshot({ id: 'run_1', status, updatedAt: 100 }, null), false)
  }
  assert.equal(shouldApplyRunSnapshot({ id: 'run_1', status: 'completed', updatedAt: 100 }, null), true)
  assert.equal(shouldApplyRunSnapshot(null, null), true)
})

test('Work approval card renders Approve and Deny for a projected waiting run', () => {
  const run = toAgentRunResource(waitingRunDoc)
  function ApprovalCard() {
    const { workApprovalContent } = useWorkApproval({
      agentRunLifecycle: {
        run,
        refresh: async () => run,
      } as never,
      activeChatId: 'conversation_1',
    })
    return createElement('div', null, workApprovalContent)
  }

  const markup = renderToStaticMarkup(createElement(ApprovalCard))
  assert.match(markup, /computer_browser/)
  assert.match(markup, /Approve/)
  assert.match(markup, /Deny/)
})
