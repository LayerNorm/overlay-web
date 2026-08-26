import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAssistantVisualSequence } from './visual-sequence'

test('terminal remote run status resolves stale remote action and terminal visuals', () => {
  const blocks = buildAssistantVisualSequence([
    { type: 'tool-invocation', toolInvocation: {
      toolCallId: 'action-1', toolName: 'remote_action', state: 'input-available',
      toolInput: { title: 'Remote action' },
    } },
    { type: 'data-remote-agent-terminal', data: {
      key: 'terminal-1', title: 'Remote terminal', summary: 'Attached terminal', status: 'running',
    } },
    { type: 'data-remote-agent-status', data: { state: 'completed' } },
  ])

  const tools = blocks.filter((block) => block.kind === 'tool')
  assert.deepEqual(tools.map((tool) => tool.state), ['output-available', 'output-available'])
})

test('active remote run status keeps running remote visuals in progress', () => {
  const blocks = buildAssistantVisualSequence([
    { type: 'tool-invocation', toolInvocation: {
      toolCallId: 'action-1', toolName: 'remote_action', state: 'input-available',
      toolInput: { title: 'Remote action' },
    } },
    { type: 'data-remote-agent-terminal', data: {
      key: 'terminal-1', title: 'Remote terminal', summary: 'Attached terminal', status: 'running',
    } },
    { type: 'data-remote-agent-status', data: { state: 'running' } },
  ])

  const tools = blocks.filter((block) => block.kind === 'tool')
  assert.deepEqual(tools.map((tool) => tool.state), ['input-available', 'input-available'])
})
