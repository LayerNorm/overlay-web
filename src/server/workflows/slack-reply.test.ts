import assert from 'node:assert/strict'
import test from 'node:test'
import { slackTurnText } from './slack-reply'

test('every assistant message of the turn is posted, in order, and nothing from other turns', () => {
  const messages = [
    { role: 'user', turnId: 't1', content: 'question' },
    { role: 'assistant', turnId: 't0', content: 'an earlier answer' },
    { role: 'assistant', turnId: 't1', content: 'First part.' },
    { role: 'assistant', turnId: 't1', content: '  ' },
    { role: 'assistant', turnId: 't1', content: 'Second part.' },
  ]
  assert.equal(slackTurnText(messages, 't1'), 'First part.\n\nSecond part.')
  assert.equal(slackTurnText(messages, 't9'), '')
})
