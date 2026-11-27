import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
it('vendors the canonical bridge fingerprint without drift', () => {
  const source = readFileSync('packages/overlay-desktop-bridge/src/index.ts')
  const expected = readFileSync('packages/overlay-desktop-bridge/source.sha256', 'utf8').trim()
  expect(createHash('sha256').update(source).digest('hex')).toBe(expected)
})
