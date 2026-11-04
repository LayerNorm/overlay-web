import { expect, test } from 'vitest'
import { buildHarnessRunnerCheckpoint } from './runner-checkpoint'

test('checkpoint persists repair accounting and strips internal prose from public text', () => {
  const repair = 'Fixing the plan format - `status` should not be included in the set operation:'
  const text = `The source was read.\n\n${repair}\n\nThe result is ready.`
  const checkpoint = buildHarnessRunnerCheckpoint({
    messages: [{ role: 'assistant', content: text }],
    invocation: 1,
    modelCall: 2,
    stagnantSegments: 0,
    finalAnswerRequired: true,
    planRepair: { attempts: 3, evidence: 'evidence-fingerprint' },
    truncatedResponse: false,
    segmentStartedAt: 1,
    deliverySteps: [{ stepNumber: 1, text, content: [{ type: 'text', text }], toolCalls: [], toolResults: [] } as never],
    toolApprovals: [],
    executionOutcomes: new Map(),
    authenticatedDenials: new Map(),
  })
  expect(checkpoint.planRepair).toEqual({ attempts: 3, evidence: 'evidence-fingerprint' })
  expect(JSON.stringify(checkpoint)).toContain('The source was read.')
  expect(JSON.stringify(checkpoint)).toContain('The result is ready.')
  expect(JSON.stringify(checkpoint)).not.toContain(repair)
})
