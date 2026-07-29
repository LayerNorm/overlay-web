import assert from 'node:assert/strict'
import test from 'node:test'
import { extractQueryTerms, findPassageHighlights } from './passage-highlight'

test('extracts meaningful terms and drops stop words', () => {
  assert.deepEqual(extractQueryTerms('What is the refund window for a policy?'), [
    'refund',
    'window',
    'policy',
  ])
})

test('keeps quoted phrases intact', () => {
  assert.deepEqual(extractQueryTerms('"refund window" policy'), ['refund window', 'policy'])
})

test('highlights each matching term with case-insensitive offsets', () => {
  const passage = 'The Refund window is 30 days. Refund requests go to billing.'
  const highlights = findPassageHighlights(passage, 'refund window')
  assert.deepEqual(highlights, [
    { start: 4, end: 10 },
    { start: 11, end: 17 },
    { start: 30, end: 36 },
  ])
  assert.equal(passage.slice(4, 10), 'Refund')
  assert.equal(passage.slice(11, 17), 'window')
  assert.equal(passage.slice(30, 36), 'Refund')
})

test('does not highlight a term embedded inside a longer word', () => {
  assert.deepEqual(findPassageHighlights('Start the cart department', 'art'), [])
})

test('a quoted phrase highlights as one span', () => {
  const passage = 'Our refund window policy is fixed.'
  assert.deepEqual(findPassageHighlights(passage, '"refund window"'), [{ start: 4, end: 17 }])
  assert.equal(passage.slice(4, 17), 'refund window')
})

test('overlapping matches merge into non-overlapping ordered spans', () => {
  const passage = 'refundrefund refund'
  const highlights = findPassageHighlights(passage, '"refundrefund" refund')
  for (let index = 1; index < highlights.length; index += 1) {
    assert.ok(highlights[index]!.start >= highlights[index - 1]!.end, 'spans must not overlap')
  }
})

test('returns nothing for an empty passage or query', () => {
  assert.deepEqual(findPassageHighlights('', 'refund'), [])
  assert.deepEqual(findPassageHighlights('refund', '   '), [])
})

test('a query of only stop words highlights nothing', () => {
  assert.deepEqual(findPassageHighlights('the policy is here', 'the is'), [])
})

test('highlight count stays bounded on a pathological repeat', () => {
  const passage = Array.from({ length: 500 }, () => 'refund').join(' ')
  assert.ok(findPassageHighlights(passage, 'refund').length <= 40)
})
