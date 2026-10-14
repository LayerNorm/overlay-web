import assert from 'node:assert/strict'
import test from 'node:test'
import * as canonical from '../../app/.well-known/oauth-authorization-server/route'
import * as compatibility from '../../app/.well-known/openid-configuration/route'

test('both discovery addresses use the same canonical request-time handlers', () => {
  assert.equal(compatibility.GET, canonical.GET)
  assert.equal(compatibility.OPTIONS, canonical.OPTIONS)
})
