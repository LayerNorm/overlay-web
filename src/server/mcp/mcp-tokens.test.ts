import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { openMcpValue, pkceMatches, sealMcpValue } from './mcp-tokens'

process.env.INTERNAL_API_SECRET = 'test-secret-for-mcp-tokens'

test('a sealed value opens to its payload and expires', () => {
  const token = sealMcpValue('access', { g: 'grant-1' }, 60_000)!
  assert.match(token, /^ovmcu_a_/)
  assert.equal(openMcpValue('access', token)?.g, 'grant-1')
  const expired = sealMcpValue('access', { g: 'grant-1' }, -1)
  assert.equal(openMcpValue('access', expired), null)
})

test('a value only opens as the kind it was sealed as', () => {
  const refresh = sealMcpValue('refresh', { g: 'grant-1', v: 0 }, 60_000)!
  assert.equal(openMcpValue('access', refresh), null)
  assert.equal(openMcpValue('refresh', refresh)?.v, 0)
  // Re-prefixing a refresh token as an access token does not get past the signature.
  assert.equal(openMcpValue('access', refresh.replace('ovmcu_r_', 'ovmcu_a_')), null)
})

test('tampering with the payload or signature is rejected', () => {
  const token = sealMcpValue('code', { id: 'c1', uid: 'user-1' }, 60_000)!
  const [head, sig] = token.split('.')
  const forged = Buffer.from(JSON.stringify({ id: 'c1', uid: 'user-2', exp: Date.now() + 60_000 })).toString('base64url')
  assert.equal(openMcpValue('code', `ovcode_${forged}.${sig}`), null)
  assert.equal(openMcpValue('code', `${head}.${sig!.slice(0, -2)}AA`), null)
  assert.equal(openMcpValue('code', 'ovcode_garbage'), null)
  assert.equal(openMcpValue('code', null), null)
})

test('PKCE accepts the matching S256 verifier only', () => {
  const verifier = 'a'.repeat(64)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  assert.equal(pkceMatches(verifier, challenge), true)
  assert.equal(pkceMatches('b'.repeat(64), challenge), false)
  assert.equal(pkceMatches('short', challenge), false)
  assert.equal(pkceMatches(verifier, verifier), false)
})
