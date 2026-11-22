import assert from 'node:assert/strict'
import test from 'node:test'
import { ComputerPatchError, applyComputerPatchHunks, computerPatchPaths, parseComputerPatch, planComputerPatch } from './computer-patch'

const patch = (body: string) => `*** Begin Patch\n${body}\n*** End Patch\n`

test('parses add, delete, update and move', () => {
  const ops = parseComputerPatch(patch([
    '*** Add File: /r/new.ts',
    '+export const x = 1',
    '*** Delete File: /r/old.ts',
    '*** Update File: /r/a.ts',
    '*** Move to: /r/b.ts',
    '@@ function main',
    ' const a = 1',
    '-const b = 2',
    '+const b = 3',
  ].join('\n')))
  assert.deepEqual(ops.map(op => op.kind), ['add', 'delete', 'update'])
  assert.deepEqual(ops[0], { kind: 'add', path: '/r/new.ts', contents: 'export const x = 1\n' })
  assert.equal(ops[2]!.kind === 'update' && ops[2]!.moveTo, '/r/b.ts')
  assert.deepEqual(computerPatchPaths(ops), ['/r/new.ts', '/r/old.ts', '/r/a.ts', '/r/b.ts'])
})

test('rejects malformed patches with line numbers', () => {
  assert.throws(() => parseComputerPatch('*** Update File: a\n'), /Begin Patch/)
  assert.throws(() => parseComputerPatch(patch('*** Add File: a\nno plus')), /line 3: Every line/)
  assert.throws(() => parseComputerPatch(patch('*** Update File: a\n@@\n*x')), /must start with/)
  assert.throws(() => parseComputerPatch(patch('')), /no file operations/)
})

test('hunks apply in order using anchors to pick the right occurrence', () => {
  const source = 'function a() {\n  return 1\n}\nfunction b() {\n  return 1\n}\n'
  const ops = parseComputerPatch(patch('*** Update File: f\n@@ function b\n-  return 1\n+  return 2'))
  assert.equal(applyComputerPatchHunks('f', source, ops[0]!.kind === 'update' ? ops[0]!.hunks : []),
    'function a() {\n  return 1\n}\nfunction b() {\n  return 2\n}\n')
})

test('matching tolerates trailing whitespace differences and keeps CRLF', () => {
  const ops = parseComputerPatch(patch('*** Update File: f\n@@\n a\n-b\n+B'))
  const hunks = ops[0]!.kind === 'update' ? ops[0]!.hunks : []
  assert.equal(applyComputerPatchHunks('f', 'a   \nb\nc\n', hunks), 'a\nB\nc\n')
  assert.equal(applyComputerPatchHunks('f', 'a\r\nb\r\nc\r\n', hunks), 'a\r\nB\r\nc\r\n')
})

test('a hunk that does not match explains what it expected', () => {
  const ops = parseComputerPatch(patch('*** Update File: f\n@@\n-missing line\n+x'))
  assert.throws(() => applyComputerPatchHunks('f', 'a\n', ops[0]!.kind === 'update' ? ops[0]!.hunks : []), /hunk 1 did not match[\s\S]*missing line/)
})

test('End of File hunks append at the end', () => {
  const ops = parseComputerPatch(patch('*** Update File: f\n@@\n+tail\n*** End of File'))
  assert.equal(applyComputerPatchHunks('f', 'a\nb\n', ops[0]!.kind === 'update' ? ops[0]!.hunks : []), 'a\nb\ntail\n')
})

test('planning is all-or-nothing and checks existence', () => {
  const ops = parseComputerPatch(patch('*** Add File: /n\n+x\n*** Update File: /a\n@@\n-1\n+2\n*** Delete File: /d\n*** Update File: /m\n*** Move to: /m2\n@@\n-k\n+K'))
  const files = new Map<string, string | null>([['/n', null], ['/a', '1\n'], ['/d', 'gone\n'], ['/m', 'k\n'], ['/m2', null]])
  const changes = planComputerPatch(ops, files)
  assert.deepEqual(changes.map(change => [change.kind, change.path, 'after' in change ? change.after : null]), [
    ['add', '/n', 'x\n'], ['update', '/a', '2\n'], ['delete', '/d', null], ['update', '/m', 'K\n'],
  ])
  assert.throws(() => planComputerPatch(ops, new Map(files).set('/n', 'exists')), /already exists/)
  assert.throws(() => planComputerPatch(ops, new Map(files).set('/d', null)), /cannot be deleted/)
  assert.throws(() => planComputerPatch(ops, new Map(files).set('/m2', 'taken')), /destination already exists/)
  assert.throws(() => planComputerPatch(ops, new Map(files).set('/a', '9\n')), ComputerPatchError)
  const dup = parseComputerPatch(patch('*** Update File: /a\n@@\n-1\n+2\n*** Delete File: /a'))
  assert.throws(() => planComputerPatch(dup, files), /more than once/)
})
