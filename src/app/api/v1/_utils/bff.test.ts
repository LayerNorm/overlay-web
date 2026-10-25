import assert from 'node:assert/strict'
import test from 'node:test'
import { isBffSessionSatisfied } from './bff'

test('account routes can require a signed browser session without changing default auth compatibility', () => {
  for (const authType of ['api-key', 'service', 'access-token'] as const) {
    assert.equal(isBffSessionSatisfied(authType, true), false)
    assert.equal(isBffSessionSatisfied(authType, false), true)
    assert.equal(isBffSessionSatisfied(authType, undefined), true)
  }
  assert.equal(isBffSessionSatisfied('session', true), true)
})
