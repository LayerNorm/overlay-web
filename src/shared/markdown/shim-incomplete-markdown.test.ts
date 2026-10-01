import test from 'node:test'
import assert from 'node:assert/strict'

import { shimIncompleteMarkdown } from './shim-incomplete-markdown.ts'

test('leaves already-balanced markdown unchanged', () => {
  const balanced = 'Hello **world**. `code` and _italic_.'
  assert.equal(shimIncompleteMarkdown(balanced), balanced)
})

test('closes an unclosed fenced code block', () => {
  const input = 'Here is code:\n```ts\nconst x = 1'
  const result = shimIncompleteMarkdown(input)
  assert.ok(result.endsWith('\n```'), `expected trailing close fence, got: ${JSON.stringify(result)}`)
  // Two fences total → parses cleanly
  assert.equal(result.match(/^```/gm)!.length, 2)
})

test('leaves a closed fenced code block alone', () => {
  const input = '```\nx\n```'
  assert.equal(shimIncompleteMarkdown(input), input)
})

test('closes an unclosed $$ math block', () => {
  const input = 'Euler:\n$$\ne^{i\\pi} + 1 = 0'
  const result = shimIncompleteMarkdown(input)
  assert.ok(result.endsWith('\n$$'))
})

test('closes a one-line tail that opened $$ without a closing pair', () => {
  const input = 'QR step: $$A_{k+1} = R_k Q_k'
  const result = shimIncompleteMarkdown(input)
  assert.ok(result.endsWith('$$'))
  assert.equal((result.match(/\$\$/g) ?? []).length, 2)
})

test('does not count $$ inside a fenced code block', () => {
  const input = '```\n$$\n```\nStill open: $$\\frac12'
  const result = shimIncompleteMarkdown(input)
  assert.ok(result.endsWith('$$'))
})

test('adds a synthetic separator for an unclosed table header', () => {
  const input = '| Name | Value |\n| Alice'
  const result = shimIncompleteMarkdown(input)
  assert.match(result, /\|\s*---\s*\|\s*---\s*\|/)
  // Synthetic separator should come between header and first data row
  const lines = result.split('\n')
  assert.equal(lines[0], '| Name | Value |')
  assert.match(lines[1]!, /\|\s*---\s*\|\s*---\s*\|/)
  assert.equal(lines[2], '| Alice')
})

test('does not add a separator when the real one already arrived', () => {
  const input = '| A | B |\n| --- | --- |\n| 1 | 2'
  const result = shimIncompleteMarkdown(input)
  // Only one separator should exist — no double synthesis
  const separators = result.split('\n').filter((l) => /\|\s*---/.test(l))
  assert.equal(separators.length, 1)
})

test('closes an unclosed bold span on the current line', () => {
  const input = 'This is **important'
  assert.equal(shimIncompleteMarkdown(input), 'This is **important**')
})

test('closes an unclosed italic span on the current line', () => {
  const input = 'Really *very'
  assert.equal(shimIncompleteMarkdown(input), 'Really *very*')
})

test('closes an unclosed inline code span on the current line', () => {
  const input = 'Use `functionName'
  assert.equal(shimIncompleteMarkdown(input), 'Use `functionName`')
})

test('ignores list-marker asterisks when closing italics', () => {
  const input = '* one\n* two\n* three'
  assert.equal(shimIncompleteMarkdown(input), input)
})

test('treats pipe inside inline code as literal (no table shim)', () => {
  const input = 'Use `a | b` to separate'
  // There is a single backtick-wrapped pipe — line does not start with `|`, so no table shim
  assert.equal(shimIncompleteMarkdown(input), input)
})

test('does not close a backtick inside a fenced code block', () => {
  // Inside an unclosed fence, the fence-close is the primary shim.
  const input = '```\nconst s = `hello'
  const result = shimIncompleteMarkdown(input)
  assert.ok(result.endsWith('\n```'))
  // Should not also append a lone backtick (fence-close is the shim)
  assert.equal(result, '```\nconst s = `hello\n```')
})

test('handles streaming a table row character-by-character without breaking', () => {
  const stages = [
    '| A | B |',
    '| A | B |\n',
    '| A | B |\n|',
    '| A | B |\n| 1',
    '| A | B |\n| 1 |',
    '| A | B |\n| 1 | 2',
    '| A | B |\n| 1 | 2 |',
  ]
  for (const stage of stages) {
    const result = shimIncompleteMarkdown(stage)
    // Must always either be the input unchanged (when balanced) OR contain a separator
    assert.ok(
      result === stage || /\|\s*---\s*\|\s*---\s*\|/.test(result),
      `stage ${JSON.stringify(stage)} produced unexpected ${JSON.stringify(result)}`,
    )
  }
})

test('returns empty string unchanged', () => {
  assert.equal(shimIncompleteMarkdown(''), '')
})

test('is idempotent when applied twice', () => {
  const input = 'Broken **bold and `code'
  const once = shimIncompleteMarkdown(input)
  const twice = shimIncompleteMarkdown(once)
  assert.equal(once, twice)
})
