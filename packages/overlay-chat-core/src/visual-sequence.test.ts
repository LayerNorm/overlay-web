import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAssistantVisualSequence } from './visual-sequence'

test('failed and denied generated UI calls remain visible in persisted and SDK formats', () => {
  for (const name of ['render_ui', 'present_generated_ui']) {
    for (const state of ['output-error', 'output-denied', 'output-available']) {
      const output = state === 'output-available' ? { success: false, error: 'Invalid spec' } : undefined
      for (const part of [
        { type: 'tool-invocation', toolInvocation: { toolCallId: 'failed', toolName: name, state, toolOutput: output } },
        { type: `tool-${name}`, toolCallId: 'failed', state, output },
      ]) {
        const blocks = buildAssistantVisualSequence([part])
        assert.equal(blocks[0]?.kind, 'tool')
        if (blocks[0]?.kind === 'tool') assert.equal(blocks[0].state, state === 'output-denied' ? state : 'output-error')
      }
    }
  }
})

test('normalizes keyed SDK previews, deduplicates tool inputs, and lets terminal results win', () => {
  const stream = [
    { op: 'add', path: '/root', value: 'root' },
    { op: 'add', path: '/elements/root', value: { type: 'Stack', props: {}, children: [] } },
  ].map(line => JSON.stringify(line)).join('\n') + '\n'
  const input = { type: 'tool-invocation', toolInvocation: {
    toolCallId: 'render-1', toolName: 'render_ui', state: 'input-available',
    toolInput: { summary: 'Building', specStream: stream },
  } }
  const sdkPreview = { type: 'data-overlay.generated_ui', id: 'render-1', data: {
    version: 1, kind: 'json_render', catalogVersion: 1, summary: 'Building', streaming: true,
    specJson: JSON.stringify({ root: 'root', elements: { root: { type: 'Text', props: { text: 'Preview' } } } }),
  } }
  const duplicate = buildAssistantVisualSequence([input, sdkPreview])
  assert.deepEqual(duplicate.map(block => block.kind), ['generated-ui'])
  assert.deepEqual(buildAssistantVisualSequence([{ type: 'data-overlay.generated_ui', id: 'render-1', data: { kind: 'preview-cleared' } }]), [])
  if (duplicate[0]?.kind === 'generated-ui') {
    assert.equal(duplicate[0].part.type, 'data')
    assert.equal(duplicate[0].part.transient, true)
  }

  const finalOutput = { type: 'tool-invocation', toolInvocation: {
    toolCallId: 'render-1', toolName: 'render_ui', state: 'output-available',
    toolOutput: { success: true, generatedUi: { version: 1, kind: 'json_render', catalogVersion: 1,
      summary: 'Final', specJson: sdkPreview.data.specJson } },
  } }
  const success = buildAssistantVisualSequence([input, sdkPreview, finalOutput])
  assert.deepEqual(success.map(block => block.kind), ['generated-ui'])
  if (success[0]?.kind === 'generated-ui') assert.equal(success[0].part.data.kind === 'json_render' && success[0].part.data.summary, 'Final')

  const failed = buildAssistantVisualSequence([input, sdkPreview, {
    type: 'tool-invocation', toolInvocation: { toolCallId: 'render-1', toolName: 'render_ui', state: 'output-error' },
  }])
  assert.deepEqual(failed.map(block => block.kind), ['tool'])
  assert.deepEqual(buildAssistantVisualSequence([input, sdkPreview], { terminalState: 'cancelled' }), [])
})

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

test('harness control tools are not shown as work', () => {
  const blocks = buildAssistantVisualSequence([
    { type: 'tool-invocation', toolInvocation: { toolCallId: 'plan', toolName: 'harness_set_plan', state: 'output-available', toolOutput: {} } },
    { type: 'tool-harness_update_step', toolCallId: 'step', state: 'output-available', input: {}, output: {} },
    { type: 'tool-web_search', toolCallId: 'search', state: 'output-available', input: {}, output: {} },
  ])
  assert.deepEqual(blocks.map(block => block.kind === 'tool' ? block.name : block.kind), ['web_search'])
})
