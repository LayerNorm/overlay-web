import assert from 'node:assert/strict'
import test from 'node:test'
import { applyStoredContentSafetyHeaders } from './stored-content-headers'

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
