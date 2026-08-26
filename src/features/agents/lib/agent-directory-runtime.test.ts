import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentBinding } from '@overlay/workspace-contracts'
import { getAgentRuntimeLabel, indexActiveAgentBindings } from './agent-directory-runtime'

function binding(overrides: Partial<AgentBinding> = {}): AgentBinding {
  return {
    id: 'binding-1',
    workspaceId: 'workspace-1',
    agentId: 'agent-1',
    environmentId: 'environment-1',
    protocolAdapter: 'acp',
    adapterConfig: { adapterId: 'codex', workingDirectory: '/workspace' },
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

test('active bindings label legacy agent identities as connected harnesses', () => {
  assert.equal(
    getAgentRuntimeLabel('moonshotai/kimi-k2.6', binding()),
    'codex · connected',
  )
})

test('binding indexing ignores disabled rows and keeps the newest active row', () => {
  const active = binding({ id: 'active', updatedAt: 3 })
  const indexed = indexActiveAgentBindings([
    binding({ id: 'disabled', enabled: false, updatedAt: 4 }),
    active,
    binding({ id: 'older', updatedAt: 2 }),
  ])

  assert.equal(indexed.get('agent-1')?.id, 'active')
})

test('new BYO identities retain their adapter fallback before binding metadata loads', () => {
  assert.equal(getAgentRuntimeLabel('byo/claude-code'), 'claude-code · connected')
  assert.equal(getAgentRuntimeLabel('openrouter/free'), 'openrouter/free')
})
