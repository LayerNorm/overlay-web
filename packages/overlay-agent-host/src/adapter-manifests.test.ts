import assert from 'node:assert/strict'
import test from 'node:test'
import { ACP_ADAPTER_MANIFESTS, resolveAcpAdapterManifest } from './adapter-manifests'

test('first native ACP targets are data-only manifests', () => {
  assert.deepEqual(Object.keys(ACP_ADAPTER_MANIFESTS), ['codex', 'claude-code'])
  assert.deepEqual(resolveAcpAdapterManifest('codex'), {
    id: 'codex',
    displayName: 'Codex',
    protocol: 'acp',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/codex-acp'],
  })
  assert.deepEqual(resolveAcpAdapterManifest('claude-code'), {
    id: 'claude-code',
    displayName: 'Claude Code',
    protocol: 'acp',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/claude-agent-acp'],
  })
})

test('unknown ACP targets do not acquire implicit command execution', () => {
  assert.equal(resolveAcpAdapterManifest('not-installed'), undefined)
})
