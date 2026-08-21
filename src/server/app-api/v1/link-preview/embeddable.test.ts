import assert from 'node:assert/strict'
import test from 'node:test'
import { framedByHeaders } from './embeddable'

const APP_ORIGIN = 'https://app.getoverlay.io'

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries)
}

test('a page with no framing headers can be previewed', () => {
  assert.equal(framedByHeaders(headers({}), APP_ORIGIN), true)
})

test('X-Frame-Options blocks the preview', () => {
  assert.equal(framedByHeaders(headers({ 'x-frame-options': 'DENY' }), APP_ORIGIN), false)
  assert.equal(framedByHeaders(headers({ 'x-frame-options': 'sameorigin' }), APP_ORIGIN), false)
  assert.equal(
    framedByHeaders(headers({ 'x-frame-options': 'ALLOW-FROM https://example.com' }), APP_ORIGIN),
    false,
  )
})

test('frame-ancestors none blocks the preview', () => {
  assert.equal(
    framedByHeaders(
      headers({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }),
      APP_ORIGIN,
    ),
    false,
  )
})

test('frame-ancestors that names another site blocks the preview', () => {
  assert.equal(
    framedByHeaders(headers({ 'content-security-policy': 'frame-ancestors https://other.example' }), APP_ORIGIN),
    false,
  )
})

test('frame-ancestors that admits us allows the preview', () => {
  for (const value of ['*', 'https:', APP_ORIGIN, '*.getoverlay.io']) {
    assert.equal(
      framedByHeaders(headers({ 'content-security-policy': `frame-ancestors ${value}` }), APP_ORIGIN),
      true,
      `expected ${value} to allow framing`,
    )
  }
})

test('an unrelated CSP without frame-ancestors does not block', () => {
  assert.equal(
    framedByHeaders(
      headers({ 'content-security-policy': "default-src 'self'; script-src 'self'" }),
      APP_ORIGIN,
    ),
    true,
  )
})
