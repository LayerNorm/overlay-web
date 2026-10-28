import { expect, test } from 'vitest'
import { buildPersonalHarnessDelivery } from './personal-delivery'

const protocol = '<tool_call>harness_update_step<arg_key>id</arg_key><arg_value>step1</arg_value><arg_key>status</arg_key><arg_value>done</arg_value></tool_call>'

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
  const delivery = buildPersonalHarnessDelivery(result, undefined, [], new Set(['read_file']))
  expect(delivery.content).toBe('Read complete.')
  expect(JSON.stringify(delivery.parts)).not.toContain(call)
})
