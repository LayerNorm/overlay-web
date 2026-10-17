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

test('attached terminal detail follows its completed action while the turn continues', () => {
  for (const state of ['output-available', 'output-error', 'output-denied']) {
    const action = {type: 'tool-invocation', toolInvocation: {
      toolCallId: 'finished', toolName: 'remote_action', state,
    }}
    const terminal = {type: 'data-remote-agent-terminal', data: {
      key: 'finished', terminalId: 'finished', status: 'running', text: 'Retained output',
    }}
    for (const pair of [[action, terminal], [terminal, action]]) {
      const tools = buildAssistantVisualSequence([
        ...pair,
        {type: 'tool-invocation', toolInvocation: {
          toolCallId: 'live', toolName: 'remote_action', state: 'input-available',
        }},
        {type: 'data-remote-agent-terminal', data: {key: 'standalone', status: 'running'}},
        {type: 'data-remote-agent-status', data: {state: 'running'}},
      ]).filter(block => block.kind === 'tool')
      assert.deepEqual(tools.filter(tool => tool.key === 'finished').map(tool => tool.state), [state, state])
      assert.equal(tools.find(tool => tool.key === 'live')?.state, 'input-available')
      assert.equal(tools.find(tool => tool.key === 'standalone')?.state, 'input-available')
    }
  }
})

test('repairs a word split across reasoning and text without a trailing-word regex', () => {
  const blocks = buildAssistantVisualSequence([
    { type: 'reasoning', text: 'This can', state: 'done' },
    { type: 'text', text: "'t remain split." },
  ])

  assert.deepEqual(blocks, [
    { kind: 'reasoning', key: 'reasoning-0', text: 'This', state: 'done' },
    { kind: 'text', text: "can't remain split." },
  ])
})
