import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error Node's strip-types test runner loads the adjacent TS module directly.
import { isUnsafeNetworkAddress, validatePublicNetworkUrl } from './ssrf.ts'

test('validatePublicNetworkUrl blocks localhost in production-style validation', async () => {
  const result = await validatePublicNetworkUrl('https://localhost:3333/mcp', {
    allowLocalDev: false,
    requireHttps: true,
  })
  assert.equal(result.ok, false)
})

test('validatePublicNetworkUrl rejects private IP literals', async () => {
  const result = await validatePublicNetworkUrl('https://10.0.0.5/mcp', {
    allowLocalDev: false,
    requireHttps: true,
  })
  assert.equal(result.ok, false)
})

test('validatePublicNetworkUrl allows localhost when allowLocalDev in development', async () => {
  const originalNodeEnv = process.env.NODE_ENV
  ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
  try {
    const result = await validatePublicNetworkUrl('http://localhost:3333/mcp', {
      allowLocalDev: true,
      requireHttps: false,
    })
    assert.equal(result.ok, true)
  } finally {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv
  }
})

test('network address guard rejects mapped private IPv4 and reserved IPv6 ranges', () => {
  assert.equal(isUnsafeNetworkAddress('::ffff:127.0.0.1'), true)
  assert.equal(isUnsafeNetworkAddress('::ffff:ac10:1'), true)
  assert.equal(isUnsafeNetworkAddress('fc00::1'), true)
  assert.equal(isUnsafeNetworkAddress('2001:db8::1'), true)
  assert.equal(isUnsafeNetworkAddress('2606:4700:4700::1111'), false)
})
