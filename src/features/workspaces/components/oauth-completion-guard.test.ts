import assert from 'node:assert/strict'
import test from 'node:test'
import { createOAuthCompletionGuard } from './oauth-completion-guard'

test('one Slack OAuth attempt consumes completion only once', () => {
  const consumeCompletion = createOAuthCompletionGuard()

  assert.equal(consumeCompletion(), true)
  assert.equal(consumeCompletion(), false)
})
