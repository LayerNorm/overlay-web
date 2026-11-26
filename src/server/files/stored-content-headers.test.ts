import assert from 'node:assert/strict'
import test from 'node:test'
import { applyStoredContentSafetyHeaders, htmlPageHeaders } from './stored-content-headers'

test('stored HTML is served under a script-free sandbox', () => {
  const headers = applyStoredContentSafetyHeaders(new Headers({ 'content-type': 'text/html; charset=utf-8' }))
  assert.equal(headers.get('content-security-policy'), 'sandbox')
  assert.equal(headers.get('x-content-type-options'), 'nosniff')
})

test('media and documents are served as they are', () => {
  for (const type of ['image/png', 'application/pdf', 'text/plain', 'video/mp4']) {
    const headers = applyStoredContentSafetyHeaders(new Headers({ 'content-type': type }))
    assert.equal(headers.get('content-security-policy'), null, type)
    assert.equal(headers.get('x-content-type-options'), 'nosniff')
  }
})

test('content without a type is sandboxed', () => {
  assert.equal(applyStoredContentSafetyHeaders(new Headers()).get('content-security-policy'), 'sandbox')
})

test('an HTML page runs its scripts only inside a sandbox with an opaque origin', () => {
  const headers = htmlPageHeaders('walkthrough.html')
  const policy = headers.get('content-security-policy') ?? ''
  assert.match(policy, /^sandbox allow-scripts allow-forms allow-modals;/)
  assert.doesNotMatch(policy, /allow-same-origin|allow-top-navigation|allow-popups/)
  assert.match(policy, /frame-ancestors 'self'/)
  assert.equal(headers.get('content-type'), 'text/html; charset=utf-8')
})
