import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'

test('Zod v4 rejects oversized arrays before parsing their elements', () => {
  let refinementCalls = 0
  const schema = z.array(z.string().refine(() => {
    refinementCalls += 1
    return true
  })).max(1)

  const result = schema.safeParse(['first', 'second'])

  assert.equal(result.success, false)
  assert.equal(refinementCalls, 0)
})
