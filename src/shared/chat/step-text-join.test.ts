import assert from 'node:assert/strict'
import test from 'node:test'
import type { StepResult, ToolSet } from 'ai'
import { buildAssistantPersistenceFromSteps } from './persist-assistant-turn'
import { joinStepTranscripts, stepsEndMidOutput } from './step-text-join'

// Observed in production: model:0 reached its 8,000-token output cap mid-list.
const CUT = '21. The Delta Works.\n22. The Thames Barrier.\n23'
const CONTINUED = '. The Tagus estuary barrier.\n24. The Maeslantkering.'
const LIST = `${CUT}${CONTINUED}`

function textStep(text: string, finishReason: string, toolCalls: unknown[] = []): StepResult<ToolSet> {
  return {
    stepNumber: 0, text, finishReason, reasoning: [], toolCalls, toolResults: [],
    content: [...(text ? [{ type: 'text', text }] : []), ...toolCalls],
  } as unknown as StepResult<ToolSet>
}

test('a step cut off at its output cap joins the next step without a separator', () => {
  const joined = joinStepTranscripts([
    { content: CUT, parts: [{ type: 'text', id: 'a', text: CUT }], outputLimitReached: true },
    { content: CONTINUED, parts: [{ type: 'text', id: 'b', text: CONTINUED }] },
  ])
  assert.equal(joined.content, LIST)
  assert.deepEqual(joined.parts, [{ type: 'text', id: 'a', text: LIST }])
  assert.equal(joined.outputLimitReached, false)
})

test('separate steps keep a blank line, including text before and after a tool call', () => {
  const tool = { type: 'tool-invocation', toolInvocation: { toolCallId: 'call', toolName: 'read_note' } }
  const joined = joinStepTranscripts([
    { content: 'Checking the note.', parts: [{ type: 'text', text: 'Checking the note.' }, tool] },
    { content: 'The note says hello.', parts: [{ type: 'text', text: 'The note says hello.' }] },
  ])
  assert.equal(joined.content, 'Checking the note.\n\nThe note says hello.')
  assert.equal(joined.parts.length, 3)
})

test('work between a cut-off step and the next text starts a new block', () => {
  const tool = { type: 'tool-invocation', toolInvocation: { toolCallId: 'call', toolName: 'read_note' } }
  const steps = [
    { content: CUT, parts: [{ type: 'text', text: CUT }], outputLimitReached: true },
    { content: '', parts: [tool] },
    { content: 'Next.', parts: [{ type: 'text', text: 'Next.' }] },
  ]
  assert.equal(joinStepTranscripts(steps).content, `${CUT}\n\nNext.`)
  assert.equal(stepsEndMidOutput(steps.slice(0, 1)), true)
  assert.equal(stepsEndMidOutput([...steps.slice(0, 1), { content: '', parts: [] }]), true)
  assert.equal(stepsEndMidOutput(steps), false)
})

test('raw model steps join across an output-cap cut and keep the newline the call stopped on', () => {
  const persisted = buildAssistantPersistenceFromSteps([
    textStep(CUT, 'length'),
    textStep(CONTINUED, 'stop'),
  ], '')
  assert.equal(persisted.content, LIST)
  assert.deepEqual(persisted.parts.filter(part => part.type === 'text').map(part => part.text), [LIST])

  const atNewline = buildAssistantPersistenceFromSteps([
    textStep('22. The Thames Barrier.\n', 'length'),
    textStep('23. The Tagus estuary barrier.', 'stop'),
  ], '')
  assert.equal(atNewline.content, '22. The Thames Barrier.\n23. The Tagus estuary barrier.')
})

test('raw model steps that finished normally keep their blank line', () => {
  const call = { type: 'tool-call', toolCallId: 'call', toolName: 'read_note', input: {} }
  const persisted = buildAssistantPersistenceFromSteps([
    textStep('Checking the note.', 'tool-calls', [call]),
    textStep('The note says hello.', 'stop'),
  ], '')
  assert.equal(persisted.content, 'Checking the note.\n\nThe note says hello.')
  assert.deepEqual(persisted.parts.filter(part => part.type === 'text').map(part => part.text),
    ['Checking the note.', 'The note says hello.'])
})
