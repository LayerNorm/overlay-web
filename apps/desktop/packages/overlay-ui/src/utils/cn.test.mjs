import assert from 'node:assert/strict'
import test from 'node:test'

const { cn } = await import('./cn.ts')

test('cn joins strings, arrays, and conditional classes', () => {
  assert.equal(
    cn('base', ['nested', false, ['deep']], { active: true, hidden: false }, null),
    'base nested deep active',
  )
})
