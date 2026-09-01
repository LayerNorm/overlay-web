import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSupportedNodeVersion } from './runtime-version.js'

test('the host rejects unsupported Node versions before enrollment', () => {
  assert.throws(() => assertSupportedNodeVersion('22.22.0'), /requires Node\.js 24 or newer/)
  assert.doesNotThrow(() => assertSupportedNodeVersion('24.0.0'))
  assert.doesNotThrow(() => assertSupportedNodeVersion('25.6.1'))
})
