import assert from 'node:assert/strict'
import test from 'node:test'
import { selectAffected } from './affected-shadow.mjs'

const dependencies = new Map([
  ['src/a.ts', []], ['src/b.ts', ['src/a.ts']],
  ['src/b.test.ts', ['src/b.ts']], ['src/c.test.ts', []], ['src/uncovered.ts', []],
])
const tests = ['src/b.test.ts', 'src/c.test.ts']
test('shadow follows transitive dependents', () => {
  const result = selectAffected({ changed: ['src/a.ts'], tests, dependencies })
  assert.equal(result.mode, 'candidate')
  assert.deepEqual(result.tests, ['src/b.test.ts'])
})
test('unknown inputs, deleted sources, config and missing coverage always select everything', () => {
  for (const changed of [[], ['tsconfig.json'], ['src/deleted.ts'], ['src/a.ts', 'package-lock.json']]) {
    assert.deepEqual(selectAffected({ changed, tests, dependencies }).tests, tests)
  }
  assert.equal(selectAffected({ changed: ['src/a.ts'], tests, dependencies, unknown: true }).mode, 'full')
  assert.equal(selectAffected({ changed: ['src/a.ts', 'src/uncovered.ts'], tests, dependencies }).mode, 'full')
  assert.equal(selectAffected({ changed: ['src/a.ts'], tests: ['src/c.test.ts'], dependencies }).mode, 'full')
})
