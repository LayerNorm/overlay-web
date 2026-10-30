import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendInterruptionNotice,
  INTERRUPTED_RESPONSE_NOTICE,
  normalizeAgentAssistantText,
} from './agent-assistant-text'

test('normalizes the legacy standalone interruption suffix to plain canonical text', () => {
  assert.equal(
    normalizeAgentAssistantText('The work stopped.\n\n[Interrupted by user. Continue?]'),
    `The work stopped.\n\n${INTERRUPTED_RESPONSE_NOTICE}`,
  )
})

test('preserves quoted and code interruption text', () => {
  const text = [
    'The quoted text is "[Interrupted by user. Continue?]".',
    '',
    '> [Interrupted by user. Continue?]',
    '',
    '```text',
    '[Interrupted by user. Continue?]',
    '```',
    '',
    '    [Interrupted by user. Continue?',
  ].join('\n')
  assert.equal(normalizeAgentAssistantText(text), text)
})

test('does not append a second notice when persisted text already carries one', () => {
  const reply = appendInterruptionNotice('The work stopped.\n\n[Interrupted by user. Continue?]')
  assert.equal(reply, `The work stopped.\n\n${INTERRUPTED_RESPONSE_NOTICE}`)
  assert.equal(reply.split(INTERRUPTED_RESPONSE_NOTICE).length - 1, 1)
})
