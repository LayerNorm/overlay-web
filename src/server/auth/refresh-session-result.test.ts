import assert from 'node:assert/strict'
import test from 'node:test'
import { isTerminalRefreshTokenError } from './refresh-session-result'

test('classifies only provider invalid_grant responses as terminal', () => {
  assert.equal(isTerminalRefreshTokenError({ error: 'invalid_grant' }), true)
  assert.equal(
    isTerminalRefreshTokenError({
      response: { data: { error: 'INVALID_GRANT' } },
    }),
    true,
  )
  assert.equal(isTerminalRefreshTokenError({ error: 'invalid_client' }), false)
  assert.equal(isTerminalRefreshTokenError({ status: 503 }), false)
  assert.equal(isTerminalRefreshTokenError(new Error('network failed')), false)
})
