import { vi } from 'vitest'
import { expect, test } from 'vitest'
import { buildPersonalHarnessDelivery } from './personal-delivery'

vi.mock('server-only', () => ({}))

const protocol = '<tool_call>harness_update_step<arg_key>id</arg_key><arg_value>step1</arg_value><arg_key>status</arg_key><arg_value>done</arg_value></tool_call>'

const citationFixture = {
  '1': { kind: 'memory' as const, sourceId: 'memory_1' },
  '2': { kind: 'file' as const, sourceId: 'file_2' },
}

const eightWebSources = Array.from({ length: 8 }, (_, index) => ({
  url: `https://example.test/source-${index + 1}`,
  title: `Result ${index + 1}`,
}))

function webSearchStep(text: string, output?: unknown, error?: string) {
  const call = {
    type: 'tool-call',
    toolCallId: 'web-search-1',
    toolName: 'web_search',
    input: { query: 'source citation test' },
  }
  const result = output === undefined ? undefined : {
    type: 'tool-result',
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    input: call.input,
    output,
  }
  const failure = error ? {
    type: 'tool-error',
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    input: call.input,
    error: new Error(error),
  } : undefined
  return {
    text,
    content: [call, ...(result ? [result] : []), ...(failure ? [failure] : [])],
    toolCalls: [call],
    toolResults: result ? [{
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      input: result.input,
      output: result.output,
    }] : [],
  }
}

function personalDelivery(text: string, step?: ReturnType<typeof webSearchStep>) {
  return buildPersonalHarnessDelivery({
    snapshot: {
      runId: 'run-source-citation',
      resultSummary: text,
      usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
    },
    messages: [],
    steps: [step ?? { text, content: [], toolCalls: [], toolResults: [] }],
  } as never, citationFixture)
}

test.each(['failed', 'cancelled', 'completed'])('personal %s delivery does not publish internal checkpoint summaries', status => {
  const workingSummary = 'Internal continuity: inspect pending render and reconcile provider receipt.'
  const result = {
    snapshot: {
      status,
      workingSummary,
      usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
    },
    messages: [],
    steps: [],
  } as never
  const delivery = buildPersonalHarnessDelivery(result)
  expect(JSON.stringify(delivery)).not.toContain(workingSummary)
  expect(delivery.content).toBe('[Empty response]')
})

test('personal delivery preserves the actual answer instead of replacing it with a checkpoint summary', () => {
  const answer = 'The render has started.'
  const result = {
    snapshot: {
      runId: 'run-1',
      workingSummary: 'Internal continuity: render job is pending.',
      usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
    },
    messages: [],
    steps: [{ text: answer, content: [], toolCalls: [], toolResults: [] }],
  } as never
  const delivery = buildPersonalHarnessDelivery(result)
  expect(delivery.content).toBe(answer)
  expect(delivery.parts).toEqual([{
    type: 'text', text: answer, id: JSON.stringify(['run-1', 'final', 0]),
  }])
})

test('personal transcript keeps the latest answer when the final step is a textual tool call', () => {
  const result = {
    snapshot: {
      resultSummary: protocol,
      workingSummary: protocol,
      usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
    },
    messages: [],
    steps: [
      { text: 'The capital of France is Paris.', content: [{ type: 'text', text: 'The capital of France is Paris.' }], toolCalls: [], toolResults: [] },
      { text: protocol, content: [{ type: 'text', text: protocol }], toolCalls: [], toolResults: [] },
    ],
  } as never
  const delivery = buildPersonalHarnessDelivery(result)
  expect(delivery.content).toBe('The capital of France is Paris.')
  expect(JSON.stringify(delivery.parts)).not.toContain('<tool_call>')
})

test('personal delivery leaves ambiguous numeric citations unlinked when successful web sources are present', () => {
  const text = 'Answer\n\n**Sources:** [1] [2]\n\n```text\n[1]\n```'
  const delivery = personalDelivery(text, webSearchStep(text, { sources: eightWebSources }))
  expect(delivery.content).toBe(text)
  const search = delivery.parts.find((part) => part.type === 'tool-invocation')?.toolInvocation as {
    state: string
    toolOutput: { sources: unknown[] }
  }
  expect(search.state).toBe('output-available')
  expect(search.toolOutput.sources).toHaveLength(8)
})

test('personal delivery preserves explicit internal and external links with web sources', () => {
  const text = 'Answer\n\n**Sources:** [1](/app/settings?section=memories&memory=explicit) [2](https://example.test/reference)'
  expect(personalDelivery(text, webSearchStep(text, { sources: eightWebSources })).content).toBe(text)
})

test('personal delivery keeps knowledge-only numeric citations and ignores failed or empty searches', () => {
  const text = 'Answer\n\n**Sources:** [1]'
  const expected = 'Answer\n\n**Sources:** [1](/app/settings?section=memories&memory=memory_1)'
  expect(personalDelivery(text).content).toBe(expected)
  const emptySearch = personalDelivery(text, webSearchStep(text, { sources: [] }))
  expect(emptySearch.content).toBe(expected)
  const emptyInvocation = emptySearch.parts.find((part) => part.type === 'tool-invocation')?.toolInvocation as {
    toolOutput: Record<string, unknown>
  }
  expect(emptyInvocation.toolOutput.sources).toEqual([])

  const failedSearch = personalDelivery(text, webSearchStep(text, undefined, 'search unavailable'))
  expect(failedSearch.content).toBe(expected)
  const failedInvocation = failedSearch.parts.find((part) => part.type === 'tool-invocation')?.toolInvocation as {
    state: string
    toolOutput: Record<string, unknown>
  }
  expect(failedInvocation.state).toBe('output-error')
  expect('sources' in failedInvocation.toolOutput).toBe(false)
})

test('personal transcript recognizes JSON calls from the active surface tool set', () => {
  const call = '{"name":"read_file","parameters":{"path":"record.txt"}}'
  const result = {
    snapshot: {
      resultSummary: call,
      usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
    },
    messages: [],
    steps: [
      { text: `Read complete.\n\n${call}`, content: [{ type: 'text', text: `Read complete.\n\n${call}` }], toolCalls: [], toolResults: [] },
    ],
  } as never
  const delivery = buildPersonalHarnessDelivery(result, undefined, new Set(['read_file']))
  expect(delivery.content).toBe('Read complete.')
  expect(JSON.stringify(delivery.parts)).not.toContain(call)
})

test('personal persistence removes nested tool-call arrays from per-step text parts', () => {
  const call = '[[{"name":"get_note","parameters":{"noteId":"n1"}}]]'
  const result = {
    snapshot: {
      runId: 'run-1',
      resultSummary: 'Read complete.',
      usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
    },
    messages: [],
    steps: [{
      text: `Read complete.\n\n${call}`,
      content: [{ type: 'text', text: call }],
      toolCalls: [],
      toolResults: [],
    }],
  } as never
  const delivery = buildPersonalHarnessDelivery(result, undefined, new Set(['get_note']))
  expect(delivery.parts).toEqual([{
    type: 'text', text: 'Read complete.', id: JSON.stringify(['run-1', 'final', 0]),
  }])
  expect(delivery.content).toBe('Read complete.')
})
