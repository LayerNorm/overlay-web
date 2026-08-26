import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import {
  availableByoHarnesses,
  defaultWorkingDirectory,
  environmentSupportsHarness,
  generatedByoInstructions,
  workspaceHarnessForByo,
} from './byo-agent-setup'

const environment = {
  id: 'environment-1', workspaceId: 'workspace-1', kind: 'local', name: 'Mac', status: 'online',
  capabilities: {
    adapters: [
      { id: 'codex', displayName: 'Codex', protocol: 'acp' },
      { id: 'custom-acp', displayName: 'Custom ACP', protocol: 'acp' },
      { id: 'eve', displayName: 'Eve', protocol: 'eve' },
    ],
  },
  filesystemGrant: { mode: 'selected_roots', roots: ['/repo', '/another'] },
  createdAt: 1, updatedAt: 1,
} satisfies AgentEnvironmentResource

test('BYO harness discovery keeps managed targets and adds advertised ACP adapters', () => {
  assert.deepEqual(availableByoHarnesses([environment]).map((harness) => harness.id), [
    'codex', 'claude-code', 'custom-acp',
  ])
  assert.equal(environmentSupportsHarness(environment, 'custom-acp'), true)
  assert.equal(environmentSupportsHarness(environment, 'eve'), false)
})

test('BYO defaults preserve explicit filesystem and workspace harness boundaries', () => {
  assert.equal(defaultWorkingDirectory(environment), '/repo')
  assert.equal(workspaceHarnessForByo('claude-code'), 'claude-code')
  assert.equal(workspaceHarnessForByo('codex'), 'overlay')
  assert.match(generatedByoInstructions('Codex'), /connected environment/)
})
