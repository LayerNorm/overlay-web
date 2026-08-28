import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCspPolicy, isNonceEligiblePath } from '@/proxy'

function scriptSrc(policy: string): string {
  return policy.split('; ').find((d) => d.startsWith('script-src ')) ?? ''
}

test('without a nonce the policy keeps unsafe-inline for prerendered pages', () => {
  const directive = scriptSrc(buildCspPolicy())
  assert.match(directive, /'unsafe-inline'/)
  assert.doesNotMatch(directive, /'nonce-/)
})

test('with a nonce the policy drops unsafe-inline', () => {
  // A nonce makes browsers ignore 'unsafe-inline', so it must not be emitted
  // alongside one or the hardening is silently a no-op.
  const directive = scriptSrc(buildCspPolicy('t3stN0nc3'))
  assert.match(directive, /'nonce-t3stN0nc3'/)
  assert.doesNotMatch(directive, /'unsafe-inline'/)
})

test('analytics host allowlist survives nonce mode', () => {
  const directive = scriptSrc(buildCspPolicy('t3stN0nc3'))
  assert.match(directive, /https:\/\/va\.vercel-scripts\.com/)
  assert.match(directive, /https:\/\/us-assets\.i\.posthog\.com/)
})

test('nonce is disabled unless SECURITY_CSP_NONCE is true', () => {
  delete process.env.SECURITY_CSP_NONCE
  assert.equal(isNonceEligiblePath('/app/chat'), false)
})

test('when enabled, only dynamically rendered paths are nonce-eligible', () => {
  process.env.SECURITY_CSP_NONCE = 'true'
  try {
    for (const dynamicPath of ['/app', '/app/chat', '/auth/callback', '/share/f/abc']) {
      assert.equal(isNonceEligiblePath(dynamicPath), true, `${dynamicPath} should be eligible`)
    }
    // Prerendered marketing pages must stay on unsafe-inline: a per-request
    // nonce can never match cached HTML, which would block every Next script.
    for (const staticPath of ['/', '/pricing', '/about', '/app/home', '/app/pricing', '/app/manifesto']) {
      assert.equal(isNonceEligiblePath(staticPath), false, `${staticPath} must not be eligible`)
    }
  } finally {
    delete process.env.SECURITY_CSP_NONCE
  }
})
