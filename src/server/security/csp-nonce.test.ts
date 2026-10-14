import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { buildCspPolicy, INLINE_SCRIPT_HASHES, isNonceEligiblePath } from '@/proxy'
import { THEME_INIT_SCRIPT } from '@/shared/app/theme-init-script'

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

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

test('the static shell inline scripts are allowed by hash in nonce mode only', () => {
  const withNonce = scriptSrc(buildCspPolicy('t3stN0nc3'))
  for (const hash of INLINE_SCRIPT_HASHES) assert.ok(withNonce.includes(hash), `${hash} is allowed with a nonce`)
  const withoutNonce = scriptSrc(buildCspPolicy())
  for (const hash of INLINE_SCRIPT_HASHES) assert.ok(!withoutNonce.includes(hash), 'hashes are unnecessary alongside unsafe-inline')
})

test('the theme initializer hash matches the script the layout inlines', () => {
  assert.ok(INLINE_SCRIPT_HASHES.includes(sha256(THEME_INIT_SCRIPT) as never), 'update INLINE_SCRIPT_HASHES in src/proxy.ts after editing THEME_INIT_SCRIPT')
})

test("the hash for React's shell-time script matches the installed react-dom", () => {
  // Next ships its own compiled React; the script text is what React puts in every prerendered shell.
  const require = createRequire(import.meta.url)
  const serverBundle = require.resolve('next/dist/compiled/react-dom/cjs/react-dom-server.node.production.js')
  const source = readFileSync(serverBundle, 'utf8')
  const match = source.match(/shellTimeRuntimeScript\s*=\s*stringToPrecomputedChunk\(\s*"([^"]+)"/)
  assert.ok(match, 'react-dom still defines shellTimeRuntimeScript')
  assert.ok(
    INLINE_SCRIPT_HASHES.includes(sha256(match[1]!) as never),
    'React changed its shell-time script: update INLINE_SCRIPT_HASHES in src/proxy.ts',
  )
})
