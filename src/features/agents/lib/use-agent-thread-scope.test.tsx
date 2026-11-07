import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { agentThreadScopeState } from './use-agent-thread-scope'

const directory = [{ id: 'workspace' }] as WorkspaceAgentDirectoryItem[]
const state = (args: Partial<Parameters<typeof agentThreadScopeState>[0]>) => agentThreadScopeState({
  agentId: 'workspace', conversationId: 'mine', directory, bundle: undefined, ...args,
})

test('a selected thread cannot render while its roster or thread list is loading', () => {
  assert.deepEqual(state({ directory: null }), { allowed: false, pending: true, error: null })
  assert.deepEqual(state({}), { allowed: false, pending: true, error: null })
})

test('out-of-scope and missing agent links fail closed even with a conversation id', () => {
  for (const agentId of ['personal', null]) {
    assert.deepEqual(state({ agentId }), { allowed: false, pending: false, error: 'This agent is not available in this scope.' })
  }
})

test('only the member\'s own thread with the agent verifies', () => {
  const bundle = { threads: [{ conversationId: 'mine' }] }
  assert.deepEqual(state({ bundle }), { allowed: true, pending: false, error: null })
  assert.deepEqual(state({ bundle, conversationId: 'someone-elses' }),
    { allowed: false, pending: false, error: 'This thread is not available for this agent.' })
  assert.deepEqual(state({ bundle: null }),
    { allowed: false, pending: false, error: 'This thread is not available for this agent.' })
})
