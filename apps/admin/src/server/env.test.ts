import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { allowedAdminUserIds, requiredEnv } from './env'

beforeEach(() => {
  process.env.TEST_ADMIN_VAR = '  value  '
  process.env.ADMIN_ALLOWED_USER_IDS = ' user_a ,user_b,, user_c '
})

afterEach(() => {
  delete process.env.TEST_ADMIN_VAR
  delete process.env.ADMIN_ALLOWED_USER_IDS
})

test('requiredEnv trims values and throws when unset', () => {
  assert.equal(requiredEnv('TEST_ADMIN_VAR'), 'value')
  assert.throws(() => requiredEnv('TEST_ADMIN_MISSING'), /TEST_ADMIN_MISSING/)
})

test('the allowlist parses a comma-separated WorkOS id list', () => {
  assert.deepEqual(allowedAdminUserIds(), ['user_a', 'user_b', 'user_c'])
})
