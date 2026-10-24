import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { useAgentThreadScope } from './use-agent-thread-scope'

function selection(directory: WorkspaceAgentDirectoryItem[] | null, agentId: string | null) {
  function Probe() {
    const state = useAgentThreadScope({ workspaceId: 'team', agentId, conversationId: 'personal-thread', directory, retryCount: 0 })
    return React.createElement('output', {
      'data-allowed': state.allowed,
      'data-pending': state.pending,
      'data-error': state.error ?? '',
    })
  }
  const markup = renderToStaticMarkup(React.createElement(Probe))
  return {
    allowed: /data-allowed="true"/.test(markup),
    pending: /data-pending="true"/.test(markup),
    error: markup.match(/data-error="([^"]*)"/)?.[1] || null,
  }
}

test('a selected thread cannot render while its scoped roster is loading', () => {
  assert.deepEqual(selection(null, 'personal'), { allowed: false, pending: true, error: null })
})

test('out-of-scope and missing agent links fail closed even with a conversation id', () => {
  const directory = [{ id: 'workspace' }] as WorkspaceAgentDirectoryItem[]
  for (const id of ['personal', null]) {
    assert.deepEqual(selection(directory, id), { allowed: false, pending: false, error: 'This agent is not available in this scope.' })
  }
  assert.deepEqual(selection(directory, 'workspace'), { allowed: false, pending: true, error: null })
})
