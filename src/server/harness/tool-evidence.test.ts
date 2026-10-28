import { expect, test } from 'vitest'
import { harnessToolResultEvidence, isToolFailureOutput } from './tool-evidence'
import { harnessToolInputDigest } from './tool-input-digest'

const now = 1_000
const resultEvent = (output: unknown, success = true) => ({
  toolCall: { toolCallId: 'call-1', toolName: 'create_note', input: { title: 'Doc', content: 'Text' } },
  success,
  output,
  error: success ? undefined : new Error('Tool failed.'),
}) as never

test('tool input digests ignore object key order', () => {
  const first = { title: 'Doc', details: { content: 'Text', metadata: { source: 'qa', version: 1 } }, tags: ['a', 'b'] }
  const reordered = { tags: ['a', 'b'], details: { metadata: { version: 1, source: 'qa' }, content: 'Text' }, title: 'Doc' }
  expect(harnessToolInputDigest('create_note', first)).toBe(harnessToolInputDigest('create_note', reordered))
  expect(harnessToolInputDigest('create_note', { title: 'Doc' }))
    .not.toBe(harnessToolInputDigest('create_task', { title: 'Doc' }))
})

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
