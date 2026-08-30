import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACP_ADAPTER_MANIFESTS,
  HERMES_AGENT_MINIMUM_VERSION,
  resolveAcpAdapterManifest,
} from './adapter-manifests'

test('first native ACP targets are data-only manifests', () => {
  assert.deepEqual(Object.keys(ACP_ADAPTER_MANIFESTS), ['codex', 'claude-code', 'hermes'])
  assert.deepEqual(resolveAcpAdapterManifest('codex'), {
    id: 'codex',
    displayName: 'Codex',
    protocol: 'acp',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/codex-acp@1.7.0'],
  })
  assert.deepEqual(resolveAcpAdapterManifest('claude-code'), {
    id: 'claude-code',
    displayName: 'Claude Code',
    protocol: 'acp',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/claude-agent-acp@0.70.0'],
  })
  assert.equal(HERMES_AGENT_MINIMUM_VERSION, '0.20.6')
  assert.deepEqual(resolveAcpAdapterManifest('hermes'), {
    id: 'hermes',
    displayName: 'Hermes',
    protocol: 'acp',
    command: 'hermes',
    args: ['acp'],
  })
})

test('unknown ACP targets do not acquire implicit command execution', () => {
  assert.equal(resolveAcpAdapterManifest('not-installed'), undefined)
})
