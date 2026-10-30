import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
test('the bridge source matches its vendoring fingerprint', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url))
  const expected = readFileSync(new URL('../source.sha256', import.meta.url), 'utf8').trim()
  assert.equal(createHash('sha256').update(source).digest('hex'), expected)
})
