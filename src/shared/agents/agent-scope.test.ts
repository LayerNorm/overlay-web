import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { agentsInScope } from './agent-scope'
import { pickAgentToOpen, rememberAgentOpened } from './last-agent-by-workspace'

const agents = [
  { id: 'overlay', name: 'Overlay', createdByPrincipalId: 'me' },
  { id: 'shared', name: 'Researcher', createdByPrincipalId: 'teammate' },
  { id: 'archived', name: 'Old', createdByPrincipalId: 'teammate', archivedAt: 1 },
] as WorkspaceAgentDirectoryItem[]

test('workspace selection cannot reopen the remembered personal Overlay agent', () => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  } } })
  rememberAgentOpened('workspace', 'overlay')
  const directory = agentsInScope(agents, 'me', 'workspace', false)
  assert.deepEqual(directory.map((agent) => agent.id), ['shared'])
  assert.equal(pickAgentToOpen(directory, 'workspace')?.id, 'shared')
  assert.deepEqual(agentsInScope(agents, 'me', 'personal', false).map((agent) => agent.id), ['overlay'])
})

test('empty and unresolved scopes do not fall back to personal agents; solo keeps both', () => {
  assert.deepEqual(agentsInScope(agents.slice(0, 1), 'me', 'workspace', false), [])
  assert.deepEqual(agentsInScope(agents, null, 'workspace', false), [])
  assert.deepEqual(agentsInScope(agents, 'me', 'personal', true).map((agent) => agent.id), ['overlay', 'shared'])
})
