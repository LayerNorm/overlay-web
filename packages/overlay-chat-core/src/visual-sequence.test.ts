import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAssistantVisualSequence } from './visual-sequence'
import { buildAssistantVisualSegments, planAssistantWorkCollapse } from './messages'

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

test('successful file results become one latest-revision card while preserving narrative and markdown labels', () => {
  const blocks = buildAssistantVisualSequence([
    { type: 'text', text: 'Created [Launch notes](/api/v1/files/file-1/content). Here is the result.' },
    { type: 'tool-invocation', toolInvocation: {
      toolCallId: 'write-1', toolName: 'write_file', state: 'output-available',
      toolOutput: { success: true, fileId: 'file-1', saved: { name: 'launch.md', revision: '1' }, fileReference: { fileId: 'file-1', name: 'launch.md', mimeType: 'text/markdown', revision: '1' } },
    } },
    { type: 'tool-invocation', toolInvocation: {
      toolCallId: 'write-2', toolName: 'write_file', state: 'output-available',
      toolOutput: { success: true, fileId: 'file-1', saved: { name: 'launch.md', revision: '2' }, fileReference: { fileId: 'file-1', name: 'launch.md', mimeType: 'text/markdown', revision: '2' } },
    } },
  ])
  const files = blocks.filter(block => block.kind === 'file')
  assert.equal(files.length, 1)
  assert.equal(files[0]?.kind === 'file' ? files[0].fileReference?.revision : null, '2')
  assert.equal(blocks.some(block => block.kind === 'text' && block.text.includes('Created Launch notes. Here is the result.')), true)
  const segments = buildAssistantVisualSegments(blocks)
  const collapse = planAssistantWorkCollapse(segments)
  assert.equal(collapse.collapsedIndexes.some(index => segments[index]?.kind === 'file'), false)
})

test('deduplication tracks current positions when several files are updated in one response', () => {
  const reference = (fileId: string, revision: string) => ({ fileId, name: `${fileId}.md`, mimeType: 'text/markdown', revision })
  const blocks = buildAssistantVisualSequence([
    ...['a:1', 'b:1', 'a:2', 'b:2'].map((value) => {
      const [fileId, revision] = value.split(':') as [string, string]
      return { type: 'tool-invocation', toolInvocation: {
        toolCallId: value, toolName: 'write_file', state: 'output-available',
        toolOutput: { success: true, fileReference: reference(fileId, revision) },
      } }
    }),
  ])
  assert.deepEqual(blocks.filter(block => block.kind === 'file').map(block => (
    block.kind === 'file' ? [block.fileReference?.fileId, block.fileReference?.revision] : []
  )), [['a', '2'], ['b', '2']])
})

test('failed or unknown tool results do not become cards; successful legacy notes remain supported', () => {
  const blocks = buildAssistantVisualSequence([
    { type: 'tool-invocation', toolInvocation: { toolCallId: 'failed', toolName: 'write_file', state: 'output-available', toolOutput: { success: false, fileId: 'bad', error: 'denied' } } },
    { type: 'tool-invocation', toolInvocation: { toolCallId: 'unknown', toolName: 'model_claimed_file', state: 'output-available', toolOutput: { success: true, fileReference: { fileId: 'fake', name: 'fake.png', mimeType: 'image/png' } } } },
    { type: 'tool-invocation', toolInvocation: { toolCallId: 'note', toolName: 'create_note', state: 'output-available', toolOutput: { success: true, noteId: 'note-1', saved: { title: 'Plan' }, revision: '123' } } },
  ])
  const files = blocks.filter(block => block.kind === 'file')
  assert.equal(files.length, 1)
  assert.equal(files[0]?.kind === 'file' ? files[0].fileReference?.mimeType : null, 'text/markdown')
})
