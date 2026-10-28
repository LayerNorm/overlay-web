import { expect, test } from 'vitest'
import { stripTextualToolCalls } from './textual-tool-calls'

const toolNames = new Set(['harness_update_step', 'read_file'])

test('strips XML and Python protocol forms while preserving surrounding text', () => {
  expect(stripTextualToolCalls(
    'The answer is Paris.\n\n<tool_call><arg_key>name</arg_key>harness_update_step</tool_call>\n\nVerified.',
    toolNames,
  )).toBe('The answer is Paris.\n\nVerified.')
  expect(stripTextualToolCalls('Paris\n<|python_tag|>{"name":"read_file"}', toolNames)).toBe('Paris')
})

test('strips unterminated tool-call blocks and leaves incomplete marker text alone', () => {
  expect(stripTextualToolCalls('Paris\n\n<tool_call>harness_update_step args', toolNames)).toBe('Paris')
  expect(stripTextualToolCalls('The marker is <tool_cal', toolNames)).toBe('The marker is <tool_cal')
})

test('strips known tool JSON objects and arrays, including fenced blocks and standalone lines', () => {
  const call = '{"name":"harness_update_step","parameters":{"id":"step1","status":"done"}}'
  expect(stripTextualToolCalls(call, toolNames)).toBe('')
  expect(stripTextualToolCalls(`Before\n\n\`\`\`json\n${call}\n\`\`\`\n\nAfter`, toolNames)).toBe('Before\n\nAfter')
  expect(stripTextualToolCalls(
    `Before\n${call}\nAfter`,
    toolNames,
  )).toBe('Before\nAfter')
  expect(stripTextualToolCalls(
    '[{"name":"harness_update_step","arguments":{"id":"step1"}}]',
    toolNames,
  )).toBe('')
  expect(stripTextualToolCalls(
    '[[{"name":"harness_update_step","parameters":{"id":"step1","status":"done"}}]]',
    toolNames,
  )).toBe('')
})

test('preserves unknown-tool JSON and JSON embedded in ordinary prose', () => {
  const unknown = '{"name":"unknown_tool","parameters":{"path":"a"}}'
  const known = '{"name":"read_file","arguments":{"path":"a"}}'
  expect(stripTextualToolCalls(unknown, toolNames)).toBe(unknown)
  expect(stripTextualToolCalls(`The payload is ${known} and is only an example.`, toolNames))
    .toBe(`The payload is ${known} and is only an example.`)
})

test('collapses blank lines after removing protocol blocks', () => {
  expect(stripTextualToolCalls(`Paris\n\n\n<tool_call>call</tool_call>\n\n\nFrance`, toolNames))
    .toBe('Paris\n\nFrance')
})
