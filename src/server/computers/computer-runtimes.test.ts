import assert from 'node:assert/strict'
import test from 'node:test'

import { BoxSandboxRuntime } from '@overlay/sandbox-runtime/box'

import {
  computerProviderFromEnv,
  computerRuntimeFromEnv,
  createComputerRuntimeResolver,
} from './computer-runtimes'

test('no BOX_API_KEY means the box provider does not resolve', () => {
  const env: NodeJS.ProcessEnv = {}
  assert.equal(computerProviderFromEnv(env), 'box')
  assert.equal(computerRuntimeFromEnv(undefined, env), undefined)
  assert.equal(createComputerRuntimeResolver(env)('box'), undefined)
})

test('BOX_API_KEY resolves and caches a BoxSandboxRuntime for box rows', () => {
  const env: NodeJS.ProcessEnv = { BOX_API_KEY: 'box-key' }
  const runtimeFor = createComputerRuntimeResolver(env)
  const first = runtimeFor('box')
  assert.ok(first instanceof BoxSandboxRuntime)
  assert.equal(runtimeFor('box'), first)
  assert.equal(runtimeFor(' BOX '), first)
})

test('a row on a provider other than the configured one does not resolve', () => {
  const env: NodeJS.ProcessEnv = { BOX_API_KEY: 'box-key', OVERLAY_COMPUTER_PROVIDER: 'acme' }
  const runtimeFor = createComputerRuntimeResolver(env)
  assert.equal(computerProviderFromEnv(env), 'acme')
  assert.equal(runtimeFor('box'), undefined)
  assert.equal(runtimeFor('acme'), undefined) // 'acme' is configured but has no adapter yet
})
