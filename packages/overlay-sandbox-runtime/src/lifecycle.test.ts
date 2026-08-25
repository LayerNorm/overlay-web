import assert from 'node:assert/strict'
import test from 'node:test'
import { enforceSandboxHardTimeout, enforceSandboxIdleStop } from './lifecycle'
import type { SandboxInstance } from './contracts'

test('Overlay enforces idle stop for providers without a native idle timer', async () => {
  const sandbox = lifecycleSandbox()
  assert.equal(await enforceSandboxIdleStop({ sandbox, lastActivityAt: 10, idleTimeoutMs: 10, now: 19 }), false)
  assert.equal(await enforceSandboxIdleStop({ sandbox, lastActivityAt: 10, idleTimeoutMs: 10, now: 20 }), true)
  assert.equal(await sandbox.status(), 'stopped')
})

test('Overlay deletes a sandbox at its absolute hard deadline', async () => {
  const sandbox = lifecycleSandbox()
  assert.equal(await enforceSandboxHardTimeout({ sandbox, createdAt: 10, hardTimeoutMs: 10, now: 19 }), false)
  assert.equal(await enforceSandboxHardTimeout({ sandbox, createdAt: 10, hardTimeoutMs: 10, now: 20 }), true)
  assert.equal(await sandbox.status(), 'deleted')
})

function lifecycleSandbox(): SandboxInstance {
  let state: Awaited<ReturnType<SandboxInstance['status']>> = 'running'
  return {
    provider: 'vercel', reference: 'lifecycle', name: 'lifecycle',
    capabilities: {
      commandStreaming: true, files: true, environmentVariables: true, ports: true,
      snapshots: true, persistence: true, networkPolicy: true, credentialBrokering: true,
      networkPolicyUpdates: true,
      hardTimeout: true, idleStop: false, usage: true,
    },
    status: async () => state,
    workingDirectory: async () => '/workspace',
    resume: async () => { state = 'running' },
    stop: async () => { state = 'stopped' },
    delete: async () => { state = 'deleted' },
    runCommand: async () => { throw new Error('not used') },
    writeFiles: async () => {}, readFile: async () => null, listFiles: async () => [],
    updateEnvironment: async () => {}, updateNetworkPolicy: async () => {},
    port: async (port) => ({ port, url: 'https://example.test', access: 'private' }),
    snapshot: async () => ({ id: 'snapshot', createdAt: 1 }), usage: async () => ({}),
    rawProviderDiagnosticHandle: () => null,
  }
}
