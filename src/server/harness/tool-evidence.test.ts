import { expect, test } from 'vitest'
import { harnessToolResultEvidence, isToolFailureOutput } from './tool-evidence'

const now = 1_000
const resultEvent = (output: unknown, success = true) => ({
  toolCall: { toolCallId: 'call-1', toolName: 'create_note' },
  success,
  output,
  error: success ? undefined : new Error('Tool failed.'),
}) as never

test('tool results with failure fields in output envelopes are failed evidence', () => {
  for (const output of [
    { success: false },
    { error: 'failed' },
    { errorMessage: 'failed' },
    { overlayModelOutput: { display: { error: 'failed' } } },
    { overlayModelOutput: { overlayModelOutput: { success: false } } },
  ]) {
    expect(isToolFailureOutput(output)).toBe(true)
    expect(harnessToolResultEvidence(resultEvent(output), now)).toMatchObject({
      id: 'tool:call-1',
      source: 'create_note',
      verdict: 'failed',
      createdAt: now,
    })
  }
  expect(harnessToolResultEvidence(resultEvent(undefined, false), now).verdict).toBe('failed')
  expect(harnessToolResultEvidence(resultEvent({ created: true }), now).verdict).toBe('observed')
})
