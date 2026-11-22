import assert from 'node:assert/strict'
import test from 'node:test'
import { applyComputerEdits, unifiedComputerDiff } from './computer-edit'

const source = 'const a = 1\nconst b = 2\nconst a2 = 1\n'

test('edits apply in order and see earlier edits', () => {
  const result = applyComputerEdits(source, [
    { old_string: 'const b = 2', new_string: 'const b = 3' },
    { old_string: 'const b = 3\n', new_string: 'const b = 3\nconst c = 4\n' },
  ])
  assert.deepEqual(result, { ok: true, text: 'const a = 1\nconst b = 3\nconst c = 4\nconst a2 = 1\n', replacements: 2 })
})

test('a missing match fails the whole batch', () => {
  const result = applyComputerEdits(source, [
    { old_string: 'const b = 2', new_string: 'const b = 3' },
    { old_string: 'const z = 9', new_string: 'x' },
  ])
  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.code, 'not_found')
  assert.equal(!result.ok && result.editIndex, 1)
})

test('ambiguous matches fail with line numbers unless replace_all is set', () => {
  const ambiguous = applyComputerEdits(source, [{ old_string: '= 1', new_string: '= 5' }])
  assert.equal(!ambiguous.ok && ambiguous.code, 'ambiguous')
  assert.match(!ambiguous.ok ? ambiguous.message : '', /lines 1, 3/)
  const all = applyComputerEdits(source, [{ old_string: '= 1', new_string: '= 5', replace_all: true }])
  assert.deepEqual(all, { ok: true, text: 'const a = 5\nconst b = 2\nconst a2 = 5\n', replacements: 2 })
})

test('no-op and empty edits are rejected', () => {
  assert.equal((applyComputerEdits(source, [{ old_string: 'a', new_string: 'a' }]) as { code: string }).code, 'no_op')
  assert.equal((applyComputerEdits(source, [{ old_string: '', new_string: 'a' }]) as { code: string }).code, 'empty_old_string')
})

test('replacement strings are literal, not regex replacement patterns', () => {
  const result = applyComputerEdits('price = 1\n', [{ old_string: '1', new_string: "$& $1 $$" }])
  assert.deepEqual(result, { ok: true, text: 'price = $& $1 $$\n', replacements: 1 })
})

test('CRLF files match LF edits and keep CRLF', () => {
  const result = applyComputerEdits('a\r\nb\r\nc\r\n', [{ old_string: 'a\nb', new_string: 'a\nB' }])
  assert.deepEqual(result, { ok: true, text: 'a\r\nB\r\nc\r\n', replacements: 1 })
})

test('whitespace mismatch gets a specific hint', () => {
  const result = applyComputerEdits('  indented()\n', [{ old_string: 'indented() ', new_string: 'x' }])
  assert.match(!result.ok ? result.message : '', /different surrounding whitespace/)
})

test('unified diff shows hunks with context and counts', () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const after = before.replace('line 3\n', 'line three\n').replace('line 18\n', 'line 18\nline 18b\n')
  const { diff, linesAdded, linesRemoved } = unifiedComputerDiff('/repo/f.txt', before, after)
  assert.equal(linesAdded, 2)
  assert.equal(linesRemoved, 1)
  assert.equal(diff.split('\n').filter(line => line.startsWith('@@')).length, 2)
  assert.match(diff, /^--- a\/repo\/f\.txt\n\+\+\+ b\/repo\/f\.txt\n@@ -1,6 \+1,6 @@\n line 1\n line 2\n-line 3\n\+line three\n/)
  assert.match(diff, /@@ -16,5 \+16,6 @@\n line 16\n line 17\n line 18\n\+line 18b\n line 19\n line 20$/)
  assert.equal(unifiedComputerDiff('/x', 'same\n', 'same\n').diff, '')
})
