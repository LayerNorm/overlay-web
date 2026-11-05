import { expect, test } from 'vitest'
import { buildHarnessRunnerCheckpoint } from './runner-checkpoint'

test.each([
  'Fixing the plan format - `status` should not be included in the set operation:',
  'I need to mark the `locate_pdf` milestone complete first, since the file was found in the persisted evidence.',
])('runner checkpoint strips internal prose from messages and delivery: %s', repair => {
  const text = `The source was read.\n\n${repair}\n\nThe result is ready.`
  const checkpoint = buildHarnessRunnerCheckpoint({
    messages: [{ role: 'assistant', content: text }],
    invocation: 1,
    modelCall: 2,
    stagnantSegments: 0,
    finalAnswerRequired: true,
    truncatedResponse: false,
    segmentStartedAt: 1,
    deliverySteps: [{ stepNumber: 1, text, content: [{ type: 'text', text }], toolCalls: [], toolResults: [] } as never],
    toolApprovals: [],
    executionOutcomes: new Map(),
    authenticatedDenials: new Map(),
  })
  expect(JSON.stringify(checkpoint)).toContain('The source was read.')
  expect(JSON.stringify(checkpoint)).toContain('The result is ready.')
  expect(JSON.stringify(checkpoint)).not.toContain(repair)
})
