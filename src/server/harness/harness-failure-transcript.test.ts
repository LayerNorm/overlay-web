import { expect, test } from 'vitest'
import { mergeHarnessFailureTranscript } from '../../../convex/lib/harnessFailureTranscript'

test('repeated long partial output merges without dropping unmatched text', () => {
  const settled = 'a'.repeat(80_000) + 'b'
  const live = 'a'.repeat(80_000) + 'c'
  expect(mergeHarnessFailureTranscript({ liveContent: live, liveParts: [], settledContent: settled }).content)
    .toBe(settled + '\n\n' + live)
})

test('an overlapping streamed suffix is appended once and terminal tool rows remain unique', () => {
  const part = { type: 'tool-invocation', toolInvocation: { toolCallId: 'same-call' } }
  const result = mergeHarnessFailureTranscript({ liveContent: 'middle end', liveParts: [part],
    settledContent: 'start middle', settledParts: [{ type: 'text', text: 'start middle' }, part] })
  expect(result.content).toBe('start middle end')
  expect(result.parts.filter(value => value.type === 'tool-invocation')).toHaveLength(1)
})
