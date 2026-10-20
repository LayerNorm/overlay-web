import assert from 'node:assert/strict'
import test from 'node:test'
import type { StepResult, ToolSet } from 'ai'
import { buildAssistantPersistenceFromSteps, compactAssistantPersistenceForConvex } from './persist-assistant-turn'

test('completion preserves ordered SDK text, reasoning and tool calls across steps', () => {
  const firstCall = { type: 'tool-call', toolCallId: 'list', toolName: 'list_notes', input: {} }
  const secondCall = { type: 'tool-call', toolCallId: 'read', toolName: 'read_note', input: { id: 'note-1' } }
  const steps = [
    {
      text: 'Checking now. Found a note.',
      reasoningText: 'Inspect the workspace.',
      toolCalls: [firstCall, secondCall],
      toolResults: [{ toolCallId: 'list', output: { ids: ['note-1'] } }],
      content: [
        { type: 'reasoning', text: 'Inspect the workspace.' },
        { type: 'text', text: 'Checking now.' },
        firstCall,
        { type: 'text', text: 'Found a note.' },
        secondCall,
      ],
    },
    {
      text: 'Check complete.',
      toolCalls: [],
      toolResults: [{ toolCallId: 'read', output: { text: 'Synthetic note' } }],
      content: [{ type: 'text', text: 'Check complete.' }],
    },
  ] as unknown as StepResult<ToolSet>[]

  const saved = compactAssistantPersistenceForConvex(buildAssistantPersistenceFromSteps(steps, 'fallback'))
  assert.deepEqual(saved.parts.map((part) => part.type), [
    'reasoning', 'text', 'tool-invocation', 'text', 'tool-invocation', 'text',
  ])
  assert.deepEqual(saved.parts.filter((part) => part.type === 'text').map((part) => part.text), [
    'Checking now.', 'Found a note.', 'Check complete.',
  ])
  assert.equal(saved.content, 'Checking now. Found a note.\n\nCheck complete.')
  assert.deepEqual(saved.parts[4]?.toolInvocation, {
    toolCallId: 'read', toolName: 'read_note', state: 'output-available',
    toolInput: { id: 'note-1' }, toolOutput: { text: 'Synthetic note' },
  })
})

test('legacy steps without ordered content retain their transcript and fallback text', () => {
  const steps = [{
    text: 'Done.',
    reasoningText: 'Check notes.',
    toolCalls: [{ toolCallId: 'list', toolName: 'list_notes', input: {} }],
    toolResults: [{ toolCallId: 'list', output: [] }],
  }] as unknown as StepResult<ToolSet>[]
  const saved = buildAssistantPersistenceFromSteps(steps, 'fallback')
  assert.deepEqual(saved.parts.map((part) => part.type), ['reasoning', 'tool-invocation', 'text'])
  assert.deepEqual(buildAssistantPersistenceFromSteps(undefined, 'Partial response'), {
    content: 'Partial response', parts: [{ type: 'text', text: 'Partial response' }],
  })
})
