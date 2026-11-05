import { vi } from 'vitest'
import { expect, test } from 'vitest'
import { buildPersonalHarnessDelivery } from './personal-delivery'

vi.mock('server-only', () => ({}))

const protocol = '<tool_call>harness_update_step<arg_key>id</arg_key><arg_value>step1</arg_value><arg_key>status</arg_key><arg_value>done</arg_value></tool_call>'

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
      workingSummary: 'Internal continuity: render job is pending.',
      usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
    },
    messages: [],
    steps: [{ text: answer, content: [], toolCalls: [], toolResults: [] }],
  } as never
  const delivery = buildPersonalHarnessDelivery(result)
  expect(delivery.content).toBe(answer)
  expect(delivery.parts).toEqual([{ type: 'text', text: answer }])
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
  expect(delivery.parts).toEqual([{ type: 'text', text: 'Read complete.' }])
  expect(delivery.content).toBe('Read complete.')
})

test.each([
  'Fixing the plan format - `status` should not be included in the set operation:',
  'I need to mark the `locate_pdf` milestone complete first, since the file was found in the persisted evidence.',
])('personal delivery removes repair paragraphs while keeping the actual answer: %s', leaked => {
  const answer = `I reviewed the file.\n\n${leaked}\n\nThe total is 80.`
  const delivery = buildPersonalHarnessDelivery({
    snapshot: { resultSummary: answer, usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 } },
    messages: [],
    steps: [{ text: answer, content: [{ type: 'text', text: answer }], toolCalls: [], toolResults: [] }],
  } as never)
  expect(delivery.content).toContain('I reviewed the file.')
  expect(delivery.content).toContain('The total is 80.')
  expect(delivery.content).not.toContain(leaked)
})
