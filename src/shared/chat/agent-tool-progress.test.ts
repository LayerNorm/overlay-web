import { expect, test } from 'vitest'
import { mergeAgentToolProgressPart } from './agent-tool-progress'

const part = (toolCallId: string, state: string) => ({
  type: 'tool-invocation', toolInvocation: { toolCallId, toolName: 'read_file', state, toolInput: {} },
})

test('progress merges one call into the saved parts without touching the others', () => {
  const saved = [{ type: 'text', text: 'Working' }, part('a', 'input-available'), { type: 'reasoning', text: 'hmm' }]
  expect(mergeAgentToolProgressPart(saved, part('b', 'input-available'))).toEqual([
    { type: 'text', text: 'Working' }, part('a', 'input-available'), part('b', 'input-available'),
  ])
  expect(mergeAgentToolProgressPart(saved, part('a', 'output-available'))).toEqual([
    { type: 'text', text: 'Working' }, part('a', 'output-available'),
  ])
})

test('a running update never reopens a finished call, and a part without a call id changes nothing', () => {
  expect(mergeAgentToolProgressPart([part('a', 'output-available')], part('a', 'input-available'))).toBeUndefined()
  expect(mergeAgentToolProgressPart([part('a', 'output-error')], part('a', 'input-available'))).toBeUndefined()
  expect(mergeAgentToolProgressPart([], { type: 'tool-invocation', toolInvocation: {} })).toBeUndefined()
})
