import assert from 'node:assert/strict'
import test from 'node:test'
import { readAuthErrorMessage } from './auth-error-message'

test('readAuthErrorMessage returns string errors', () => {
  assert.equal(readAuthErrorMessage({ error: 'Invalid code' }, 'Fallback'), 'Invalid code')
})

test('readAuthErrorMessage falls back for structured or missing errors', () => {
  assert.equal(readAuthErrorMessage({ error: { code: 'forbidden', message: 'Nope' } }, 'Fallback'), 'Fallback')
  assert.equal(readAuthErrorMessage({ error: '  ' }, 'Fallback'), 'Fallback')
  assert.equal(readAuthErrorMessage(null, 'Fallback'), 'Fallback')
  assert.equal(readAuthErrorMessage('not json', 'Fallback'), 'Fallback')
})
