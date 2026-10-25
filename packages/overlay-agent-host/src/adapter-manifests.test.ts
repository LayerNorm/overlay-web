import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACP_ADAPTER_MANIFESTS,
  resolveAcpAdapterManifest,
} from './adapter-manifests'

test('built-in ACP targets are limited to Claude Code and Codex', () => {
  assert.deepEqual(Object.keys(ACP_ADAPTER_MANIFESTS), ['codex', 'claude-code'])
  assert.deepEqual(resolveAcpAdapterManifest('codex'), {
    id: 'codex',
    displayName: 'Codex',
    protocol: 'acp',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/codex-acp@2.2.2'],
  })
  assert.deepEqual(resolveAcpAdapterManifest('claude-code'), {
    id: 'claude-code',
    displayName: 'Claude Code',
    protocol: 'acp',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/claude-agent-acp@0.93.0'],
  })
  assert.equal(resolveAcpAdapterManifest('hermes'), undefined)
})

test('unknown ACP targets do not acquire implicit command execution', () => {
  assert.equal(resolveAcpAdapterManifest('not-installed'), undefined)
})
