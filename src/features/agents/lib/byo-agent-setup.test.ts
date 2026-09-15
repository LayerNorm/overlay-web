import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import {
  availableByoHarnesses,
  builtInHarnessCatalogIsComplete,
  defaultWorkingDirectory,
  environmentSupportsHarness,
  generatedByoInstructions,
  workspaceAgentUsesByo,
  workspaceAgentUsesManagedHarness,
  workspaceHarnessForByo,
} from './byo-agent-setup'

const environment = {
  id: 'environment-1', workspaceId: 'workspace-1', kind: 'local', name: 'Mac', status: 'online',
  capabilities: {
    adapters: [
      { id: 'codex', displayName: 'Codex', protocol: 'acp' },
      { id: 'hermes', displayName: 'Hermes', protocol: 'acp' },
      { id: 'custom-acp', displayName: 'Custom ACP', protocol: 'acp' },
      { id: 'eve', displayName: 'Eve', protocol: 'eve' },
    ],
  },
  filesystemGrant: { mode: 'selected_roots', roots: ['/repo', '/another'] },
  createdAt: 1, updatedAt: 1,
} satisfies AgentEnvironmentResource

test('BYO harness discovery keeps built-in targets and adds advertised ACP adapters', () => {
  assert.deepEqual(availableByoHarnesses([environment]).map((harness) => harness.id), [
    'codex', 'claude-code', 'hermes', 'custom-acp',
  ])
  assert.equal(environmentSupportsHarness(environment, 'custom-acp'), true)
  assert.equal(environmentSupportsHarness(environment, 'eve'), false)
  assert.equal(builtInHarnessCatalogIsComplete(), true)
})

test('BYO defaults preserve explicit filesystem and workspace harness boundaries', () => {
  assert.equal(defaultWorkingDirectory(environment), '/repo')
  assert.equal(workspaceHarnessForByo('claude-code'), 'claude-code')
  assert.equal(workspaceHarnessForByo('codex'), 'overlay')
  assert.equal(workspaceHarnessForByo('hermes'), 'overlay')
  assert.match(generatedByoInstructions('Codex'), /connected environment/)
})

test('existing BYO identity is recognized without a binding request', () => {
  assert.equal(workspaceAgentUsesByo({ harness: 'overlay', modelId: 'byo/codex' }), true)
  assert.equal(workspaceAgentUsesByo({ harness: 'claude-code', modelId: 'byo/claude-code' }), true)
  assert.equal(workspaceAgentUsesByo({ harness: 'overlay', modelId: 'byo/hermes' }), true)
  assert.equal(workspaceAgentUsesByo({ harness: 'overlay', modelId: 'openrouter/free' }), false)
  // A managed harness shares the harness id with its BYO counterpart — the
  // byo/ model sentinel is what separates them.
  assert.equal(workspaceAgentUsesByo({ harness: 'claude-code', modelId: 'claude-sonnet-4-6' }), false)
})

test('managed harness identity separates from BYO and native Overlay agents', () => {
  assert.equal(workspaceAgentUsesManagedHarness({ harness: 'claude-code', modelId: 'claude-sonnet-4-6' }), true)
  assert.equal(workspaceAgentUsesManagedHarness({ harness: 'hermes', modelId: 'claude-sonnet-4-6' }), true)
  assert.equal(workspaceAgentUsesManagedHarness({ harness: 'overlay', modelId: 'openrouter/free' }), false)
  // BYO Claude Code carries the same harness id — the byo/ sentinel wins.
  assert.equal(workspaceAgentUsesManagedHarness({ harness: 'claude-code', modelId: 'byo/claude-code' }), false)
  assert.equal(workspaceAgentUsesManagedHarness(null), false)
})
