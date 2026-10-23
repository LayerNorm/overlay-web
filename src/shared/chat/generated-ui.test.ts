import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GENERATED_UI_DATA_TYPE,
  buildGeneratedUiPart,
  buildStreamingGeneratedUiPart,
  generatedUiDraftContainsCode,
  generatedUiDataToPlainText,
  looksLikeCodeContent,
  normalizeGeneratedUiData,
} from '@overlay/chat-core/generated-ui'
import { buildAssistantVisualSequence } from '@overlay/chat-core'
import { collectWebSourcesFromBlocks } from '@overlay/chat-core/sources'
import {
  buildAssistantPersistenceFromSteps,
  compactAssistantPersistenceForConvex,
  replaceAssistantTextForPersistence,
} from './persist-assistant-turn'

test('normalizeGeneratedUiData validates and trims text draft payloads', () => {
  const normalized = normalizeGeneratedUiData({
    version: 1,
    kind: 'draft.text',
    title: '  Essay draft  ',
    body: '  The Mughals shaped Indian history.  ',
    format: 'markdown',
  })

  assert.deepEqual(normalized, {
    version: 1,
    kind: 'draft.text',
    title: 'Essay draft',
    body: 'The Mughals shaped Indian history.',
    format: 'markdown',
  })
  assert.equal(normalizeGeneratedUiData({ version: 1, kind: 'draft.text', body: ' ' }), null)
})

test('streaming generated UI accepts partial prose drafts and rejects code payloads', () => {
  assert.deepEqual(
    buildStreamingGeneratedUiPart('tool-1', {
      kind: 'draft.email',
      subject: 'Project up',
      body: 'Hi team,\n\nHere is the current',
    }),
    {
      type: 'data',
      id: 'tool-1',
      dataType: GENERATED_UI_DATA_TYPE,
      data: {
        version: 1,
        kind: 'draft.email',
        subject: 'Project up',
        body: 'Hi team,\n\nHere is the current',
      },
      transient: true,
    },
  )

  const html = '<!DOCTYPE html>\n<html><body>Hello</body></html>'
  assert.equal(looksLikeCodeContent(html), true)
  assert.equal(generatedUiDraftContainsCode({ kind: 'draft.text', body: html }), true)
  assert.equal(buildStreamingGeneratedUiPart('tool-2', { kind: 'draft.text', body: html }), null)
  assert.equal(buildStreamingGeneratedUiPart('tool-3', {
    kind: 'draft.email',
    subject: 'Options',
    body: 'Choose an option.',
    variants: [{ label: 'HTML', body: html }],
  }), null)
})

test('assistant visual sequence renders partial generated UI input with a stable tool-call id', () => {
  const streaming = buildAssistantVisualSequence([
    {
      type: 'tool-present_generated_ui',
      toolCallId: 'call-1',
      state: 'input-streaming',
      input: {
        kind: 'draft.text',
        title: 'Launch note',
        body: 'The first streamed sentence',
      },
    },
  ])
  assert.equal(streaming[0]?.kind, 'generated-ui')
  if (streaming[0]?.kind !== 'generated-ui') assert.fail('Expected generated UI block')
  assert.equal(streaming[0].part.id, 'call-1')
  assert.equal(streaming[0].part.transient, true)
  assert.equal(streaming[0].part.data.kind, 'draft.text')
  assert.equal(streaming[0].part.data.body, 'The first streamed sentence')

  const completed = buildAssistantVisualSequence([
    {
      type: 'tool-present_generated_ui',
      toolCallId: 'call-1',
      state: 'output-available',
      input: {
        kind: 'draft.text',
        title: 'Launch note',
        body: 'The complete note.',
      },
      output: {
        success: true,
        id: 'server-generated-id',
        generatedUi: {
          version: 1,
          kind: 'draft.text',
          title: 'Launch note',
          body: 'The complete note.',
        },
      },
    },
  ])
  assert.equal(completed[0]?.kind, 'generated-ui')
  if (completed[0]?.kind !== 'generated-ui') assert.fail('Expected generated UI block')
  assert.equal(completed[0].part.id, 'call-1')
  assert.equal(completed[0].part.transient, undefined)
})

test('generated UI email data is summarized as model-readable text', () => {
  const normalized = normalizeGeneratedUiData({
    version: 1,
    kind: 'draft.email',
    subject: 'AI workspace for your team',
    body: 'Overlay keeps AI work in one place.',
    to: ['cto@example.com'],
    provider: 'gmail',
  })

  assert.ok(normalized)
  assert.equal(
    generatedUiDataToPlainText(normalized),
    'To: cto@example.com\n\nSubject: AI workspace for your team\n\nOverlay keeps AI work in one place.',
  )
})

test('present_generated_ui tool results persist as generated UI data parts', () => {
  const persistence = buildAssistantPersistenceFromSteps(
    [
      {
        text: '',
        toolCalls: [
          {
            toolCallId: 'tool-1',
            toolName: 'present_generated_ui',
            input: {},
          },
        ],
        toolResults: [
          {
            toolCallId: 'tool-1',
            output: {
              success: true,
              id: 'ui-1',
              generatedUi: {
                version: 1,
                kind: 'draft.text',
                title: 'Essay',
                body: 'A concise essay body.',
              },
            },
          },
        ],
      },
    ] as never,
    '',
  )

  assert.equal(persistence.content, 'Essay\n\nA concise essay body.')
  assert.deepEqual(persistence.parts[0], {
    type: 'data',
    id: 'ui-1',
    dataType: GENERATED_UI_DATA_TYPE,
    data: {
      version: 1,
      kind: 'draft.text',
      title: 'Essay',
      body: 'A concise essay body.',
    },
  })
})

test('ordered generated UI calls render once and failed calls retain their invocation', () => {
  const completedInput = {
    kind: 'draft.text',
    title: 'Launch note',
    body: 'The complete note.',
  }
  const failedInput = {
    kind: 'draft.text',
    title: 'Failed note',
    body: 'This was not saved.',
  }
  const persistence = buildAssistantPersistenceFromSteps(
    [
      {
        text: '',
        toolCalls: [{
          toolCallId: 'completed-ui',
          toolName: 'present_generated_ui',
          input: completedInput,
        }],
        toolResults: [{
          toolCallId: 'completed-ui',
          output: {
            success: true,
            id: 'completed-ui-result',
            generatedUi: {
              version: 1,
              ...completedInput,
            },
          },
        }],
        content: [
          {
            type: 'tool-call',
            toolCallId: 'completed-ui',
            toolName: 'present_generated_ui',
            input: completedInput,
          },
          {
            type: 'tool-result',
            toolCallId: 'completed-ui',
            toolName: 'present_generated_ui',
            output: {
              success: true,
              id: 'completed-ui-result',
              generatedUi: {
                version: 1,
                ...completedInput,
              },
            },
          },
        ],
      },
      {
        text: '',
        toolCalls: [{
          toolCallId: 'failed-ui',
          toolName: 'present_generated_ui',
          input: failedInput,
        }],
        toolResults: [],
        content: [
          {
            type: 'tool-call',
            toolCallId: 'failed-ui',
            toolName: 'present_generated_ui',
            input: failedInput,
          },
          {
            type: 'tool-error',
            toolCallId: 'failed-ui',
            toolName: 'present_generated_ui',
            error: new Error('UI renderer unavailable'),
          },
        ],
      },
    ] as never,
    '',
  )

  assert.deepEqual(persistence.parts.slice(0, 2).map((part) => part.type), ['data', 'tool-invocation'])
  assert.equal(persistence.parts.filter((part) => part.type === 'data').length, 1)
  assert.deepEqual(persistence.parts[0], {
    type: 'data',
    id: 'completed-ui-result',
    dataType: GENERATED_UI_DATA_TYPE,
    data: {
      version: 1,
      ...completedInput,
    },
  })
  assert.deepEqual(persistence.parts[1]?.toolInvocation, {
    toolCallId: 'failed-ui',
    toolName: 'present_generated_ui',
    state: 'output-error',
    toolInput: failedInput,
    toolOutput: { success: false, error: 'UI renderer unavailable' },
  })
})

test('compactAssistantPersistenceForConvex preserves only valid generated UI parts', () => {
  const validPart = buildGeneratedUiPart('ui-2', {
    version: 1,
    kind: 'connector.connect',
    serviceName: 'Asana',
    description: 'Create tasks and manage projects.',
  })
  assert.ok(validPart)

  const compacted = compactAssistantPersistenceForConvex({
    content: 'Asana\nCreate tasks and manage projects.',
    parts: [
      validPart,
      {
        type: 'data',
        id: 'bad',
        dataType: GENERATED_UI_DATA_TYPE,
        data: { version: 1, kind: 'draft.text', body: '' },
      },
    ],
  })

  assert.equal(compacted.parts.length, 2)
  assert.deepEqual(compacted.parts[0], validPart)
  assert.deepEqual(compacted.parts[1], {
    type: 'text',
    text: '[1 additional assistant parts omitted for storage]',
  })
})

test('compactAssistantPersistenceForConvex preserves normalized web sources', () => {
  const compacted = compactAssistantPersistenceForConvex({
    content: 'Answer with sources.',
    parts: [
      {
        type: 'tool-invocation',
        toolInvocation: {
          toolCallId: 'search-1',
          toolName: 'parallel_search',
          state: 'output-available',
          toolInput: { objective: 'Find reviews' },
          toolOutput: {
            results: [
              {
                url: 'https://example.com/review',
                title: 'Example review',
                snippet: 'A useful review.',
                rawContent: 'x'.repeat(10_000),
              },
              {
                url: 'https://second.example/article',
                title: 'Second article',
              },
            ],
          },
        },
      },
      { type: 'text', text: 'Answer with sources.' },
    ],
  })

  const invocation = compacted.parts[0]?.toolInvocation as
    | { toolOutput?: { sources?: unknown[]; summary?: string; truncated?: boolean } }
    | undefined
  assert.equal(invocation?.toolOutput?.truncated, true)
  assert.match(invocation?.toolOutput?.summary ?? '', /rawContent/)
  assert.deepEqual(invocation?.toolOutput?.sources, [
    {
      url: 'https://example.com/review',
      title: 'Example review',
      snippet: 'A useful review.',
      origin: 'web-search',
    },
    {
      url: 'https://second.example/article',
      title: 'Second article',
      origin: 'web-search',
    },
  ])
})

test('replaceAssistantTextForPersistence retains source-bearing tool parts', () => {
  const toolPart = {
    type: 'tool-invocation',
    toolInvocation: {
      toolCallId: 'search-1',
      toolName: 'perplexity_search',
      state: 'output-available',
      toolOutput: { sources: [{ url: 'https://example.com', title: 'Example' }] },
    },
  }
  const replaced = replaceAssistantTextForPersistence({
    content: 'Leaked tool syntax',
    parts: [
      toolPart,
      { type: 'text', text: 'Leaked tool syntax' },
    ],
  }, 'Clean answer')

  assert.equal(replaced.content, 'Clean answer')
  assert.deepEqual(replaced.parts, [
    toolPart,
    { type: 'text', text: 'Clean answer' },
  ])
})

test('legacy compacted tool summaries still recover source URLs', () => {
  const sources = collectWebSourcesFromBlocks([
    {
      kind: 'tool',
      key: 'legacy-search',
      name: 'parallel_search',
      state: 'output-available',
      toolOutput: {
        truncated: true,
        summary: '{"url":"https://example.com/review","title":"Example review"}',
      },
    },
  ])

  assert.deepEqual(sources, [{
    url: 'https://example.com/review',
    title: 'example.com',
    origin: 'web-search',
  }])
})
