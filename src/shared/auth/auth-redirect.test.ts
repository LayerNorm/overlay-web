import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_AUTH_REDIRECT, DESKTOP_AUTH_REDIRECT_URI, SESSION_TRANSFER_DEEP_LINK_PREFIX } from './auth-constants'
import { sanitizeClientAuthRedirect } from './auth-redirect'
import { ROOT_APP_DESTINATION } from './root-entry'

test('default and rejected web auth returns use the authenticated home', () => {
  assert.equal(DEFAULT_AUTH_REDIRECT, ROOT_APP_DESTINATION)
  for (const value of [undefined, null, '', '  ', '//outside.example', 'https://outside.example/account']) {
    assert.equal(sanitizeClientAuthRedirect(value), '/app/work')
  }
})

test('explicit Account, app and desktop auth return destinations are preserved', () => {
  for (const value of ['/account', '/app/agents?id=keep', DESKTOP_AUTH_REDIRECT_URI, `${SESSION_TRANSFER_DEEP_LINK_PREFIX}?ticket=fixture`]) {
    assert.equal(sanitizeClientAuthRedirect(value), value)
  }
})
