import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveChatExchangeStatus,
  generationResultViewsFromOutputGroup,
  groupTranscriptMessages,
  normalizeTranscriptAssistantParts,
  selectTranscriptResponse,
} from './transcript-view'

test('groups explicit turns while preserving response ordering', () => {
  const messages = [
    { id: 'a-1', turnId: 'turn-1', role: 'assistant' as const },
    { id: 'u-1', turnId: 'turn-1', role: 'user' as const },
    { id: 'a-2', turnId: 'turn-1', role: 'assistant' as const },
    { id: 'u-2', turnId: 'turn-2', role: 'user' as const },
  ]

  const groups = groupTranscriptMessages(messages)
  assert.deepEqual(groups.map((group) => ({
    turnId: group.turnId,
    user: group.user?.id,
    assistants: group.assistants.map((message) => message.id),
  })), [
    { turnId: 'turn-1', user: 'u-1', assistants: ['a-1', 'a-2'] },
    { turnId: 'turn-2', user: 'u-2', assistants: [] },
  ])
})
test('uses a safe alternating fallback for legacy histories without turn ids', () => {
  const groups = groupTranscriptMessages([
    { id: 'u-1', role: 'user' as const },
    { id: 'a-1', role: 'assistant' as const },
    { id: 'a-2', role: 'assistant' as const },
    { id: 'u-2', role: 'user' as const },
  ])

  assert.equal(groups.length, 2)
  assert.equal(groups[0]!.turnId, 'u-1')
  assert.deepEqual(groups[0]!.assistants.map((message) => message.id), ['a-1', 'a-2'])
  assert.equal(groups[1]!.user?.id, 'u-2')
  assert.deepEqual(groups[1]!.assistants, [])
})

test('selects multi-model responses by model, then index, then first response', () => {
  const responses = [{ modelId: 'alpha' }, { modelId: 'beta' }]
  assert.equal(selectTranscriptResponse(responses, { selectedModelId: 'beta' }).index, 1)
  assert.equal(selectTranscriptResponse(responses, { selectedModelId: 'missing', selectedIndex: 1 }).index, 1)
  assert.equal(selectTranscriptResponse(responses).response?.modelId, 'alpha')
  assert.equal(selectTranscriptResponse([], { selectedIndex: 0 }).index, -1)
})

test('derives loading, terminal, interruption, and error statuses with stable precedence', () => {
  assert.equal(deriveChatExchangeStatus({ runtimeStatus: 'submitted' }), 'submitted')
  assert.equal(deriveChatExchangeStatus({ persistedStatus: 'generating' }), 'streaming')
  assert.equal(deriveChatExchangeStatus({ runtimeStatus: 'executing_tool' }), 'executing-tool')
  assert.equal(deriveChatExchangeStatus({ hasResponse: true }), 'completed')
  assert.equal(deriveChatExchangeStatus({ interrupted: true, hasResponse: true }), 'interrupted')
  assert.equal(deriveChatExchangeStatus({ interrupted: true, error: new Error('failed') }), 'error')
})

test('normalizes ordered reasoning, tool, text, file, generated UI, and source parts', () => {
  const normalized = normalizeTranscriptAssistantParts([
    { type: 'reasoning', text: 'Check the evidence', state: 'done' },
    {
      type: 'tool-search',
      toolCallId: 'tool-1',
      state: 'output-available',
      input: { query: 'launch' },
      output: { ok: true },
    },
    {
      type: 'tool',
      toolCallId: 'tool-2',
      toolName: 'browser_read_page',
      state: 'input-available',
      input: { focus: 'primary action' },
    },
    { type: 'text', text: 'Launch is ready.' },
    { type: 'source', id: 'source-1', sourceKind: 'url', sourceId: 'url-1', url: 'https://example.test' },
    { type: 'file', url: 'data:image/png;base64,AA==', mediaType: 'image/png' },
    {
      type: 'data',
      id: 'draft-1',
      dataType: 'overlay.generated_ui',
      data: { version: 1, kind: 'draft.text', title: 'Update', body: 'Ready to ship.' },
    },
  ])

  assert.deepEqual(normalized.blocks.map((block) => block.kind), [
    'reasoning',
    'tool',
    'tool',
    'text',
    'source',
    'file',
    'generated-ui',
  ])
  assert.deepEqual(normalized.sources, [{
    id: 'source-1',
    sourceKind: 'url',
    sourceId: 'url-1',
    url: 'https://example.test',
    originIndex: 4,
  }])
})

test('restores image and video output groups without sharing mutable result objects', () => {
  const group = {
    type: 'video' as const,
    prompt: 'Animate it',
    modelIds: ['video-model'],
    createdAt: 1,
    results: [{
      type: 'video' as const,
      status: 'completed' as const,
      url: 'data:video/mp4;base64,AA==',
      modelUsed: 'video-model',
    }],
  }

  const restored = generationResultViewsFromOutputGroup(group)
  assert.deepEqual(restored, group.results)
  assert.notEqual(restored[0], group.results[0])
})
