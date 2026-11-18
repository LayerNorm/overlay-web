import assert from 'node:assert/strict'
import test from 'node:test'
import { nextRevealLength } from './smooth-stream'

test('a reveal always ends on a word boundary', () => {
  const text = 'The quick brown fox jumps over the lazy dog'
  for (let shown = 0; shown < text.length; shown += 3) {
    const next = nextRevealLength(text, shown, 16)
    assert.ok(next > shown)
    assert.ok(next === text.length || /\s/.test(text[next]!), `stopped mid-word at ${next}`)
  }
})

test('a large burst drains within one drain window, not all at once', () => {
  const text = 'word '.repeat(80)
  const firstFrame = nextRevealLength(text, 0, 32)
  assert.ok(firstFrame < text.length / 4, 'shows only part of the burst on the first frame')
  assert.equal(nextRevealLength(text, 0, 1_000), text.length, 'a long pause (background tab) catches up fully')
})

test('caught-up or shrunken text shows in full', () => {
  assert.equal(nextRevealLength('hello', 5, 32), 5)
  assert.equal(nextRevealLength('hi', 5, 32), 2)
})
