import assert from 'node:assert/strict'
import { test } from 'node:test'
import { identityInitials } from './identity-initials'

test('uses initials across words and handles empty or single names', () => {
  assert.equal(identityInitials('  Divyansh   Lalwani '), 'DL')
  assert.equal(identityInitials('Alex'), 'A')
  assert.equal(identityInitials(''), 'U')
  assert.equal(identityInitials(' ', 'W'), 'W')
})
