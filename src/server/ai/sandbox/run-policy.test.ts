import assert from 'node:assert/strict'
import test from 'node:test'
import { sandboxRunNetworkPolicy } from './run-policy'

test('standalone sandbox always denies network access', () => {
  assert.deepEqual(sandboxRunNetworkPolicy(), { mode: 'deny_all' })
})
