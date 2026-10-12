import assert from 'node:assert/strict'
import test from 'node:test'
import { initialAccess } from './AuthorizeClient'

test('the consent page starts on what one requested scope asks for, and on the middle level otherwise', () => {
  assert.equal(initialAccess('mcp:read'), 'read')
  assert.equal(initialAccess('mcp:full'), 'full')
  assert.equal(initialAccess('mcp:read mcp:write mcp:full'), 'write')
  assert.equal(initialAccess(''), 'write')
  assert.equal(initialAccess('profile email'), 'write')
})
