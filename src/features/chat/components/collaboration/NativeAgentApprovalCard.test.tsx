import test from 'node:test'
import assert from 'node:assert/strict'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NativeAgentApprovalContent } from './NativeAgentApprovalCard'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const approval = {
  runId: 'run-1', conversationId: 'conversation-1', userId: 'user-1', token: 'hook-1', requestedAt: 100,
  requests: [{ approvalId: 'approval-1', toolCallId: 'call-1', toolName: 'computer_exec', input: { command: 'echo <script>test</script>' } }],
}

function render(overrides: Partial<Parameters<typeof NativeAgentApprovalContent>[0]> = {}) {
  return renderToStaticMarkup(createElement(NativeAgentApprovalContent, {
    approval, canApprove: true, submitting: false, submitted: false, onSubmit: () => {}, ...overrides,
  }))
}

test('native approval reuses the confirmation card and safely displays exact action details', () => {
  const markup = render()
  assert.match(markup, /data-slot="confirmation"/)
  assert.match(markup, /computer_exec/)
  assert.match(markup, /echo &lt;script&gt;test&lt;\/script&gt;/)
  assert.ok(markup.indexOf('>Approve<') < markup.indexOf('>Deny<'))
})

test('other participants cannot act and submitted cards do not offer duplicate decisions', () => {
  assert.doesNotMatch(render({ canApprove: false }), /<button/)
  assert.match(render({ canApprove: false }), /Waiting for the person/)
  assert.doesNotMatch(render({ submitted: true }), /<button/)
  assert.match(render({ submitted: true }), /Decision sent/)
  assert.equal((render({ submitting: true }).match(/disabled=""/g) ?? []).length, 2)
})
