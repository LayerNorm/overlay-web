import assert from 'node:assert/strict'
import test from 'node:test'
import { looksLikeCodeContent } from './generated-ui'

test('detects HTML, module statements, and CSS without backtracking expressions', () => {
  assert.equal(looksLikeCodeContent('<section>Hello</section>'), true)
  assert.equal(looksLikeCodeContent('import value from "package"'), true)
  assert.equal(looksLikeCodeContent('export const value = 1'), true)
  assert.equal(looksLikeCodeContent('.card { background-color: black; }'), true)
})

test('keeps prose that merely contains comparison characters or code words as prose', () => {
  assert.equal(looksLikeCodeContent('Use import carefully in ordinary prose.'), false)
  assert.equal(looksLikeCodeContent('The value is < another value and > zero.'), false)
  assert.equal(looksLikeCodeContent('A card has a background color.'), false)
})

test('handles long adversarial-looking input in linear time', () => {
  const repeated = `<a${'a'.repeat(100_000)}`
  const startedAt = performance.now()
  assert.equal(looksLikeCodeContent(repeated), false)
  assert.ok(performance.now() - startedAt < 1_000)
})
