import assert from 'node:assert/strict'
import test from 'node:test'
import { lineChanges } from './overlay-executes'

test('a computer file rewrite reports lines added and removed', () => {
  assert.deepEqual(lineChanges('a\nb\nc\n', 'a\nB\nc\nd\n'), { linesAdded: 2, linesRemoved: 1 })
  assert.deepEqual(lineChanges('', 'one\ntwo'), { linesAdded: 2, linesRemoved: 0 })
  assert.deepEqual(lineChanges('same\n', 'same\n'), { linesAdded: 0, linesRemoved: 0 })
  assert.deepEqual(lineChanges('x\nx\n', 'x\n'), { linesAdded: 0, linesRemoved: 1 })
})
