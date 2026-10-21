import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { toAgentRunResource } from './useAgentRunLifecycle'
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
