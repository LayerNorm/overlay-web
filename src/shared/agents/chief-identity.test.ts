import assert from 'node:assert/strict'
import test from 'node:test'
import { chiefRoleLabel, pinChiefs, usesOverlayMark } from './chief-identity'
import { agentsForCreatorScope, sortAgentsByRecency } from './last-agent-by-workspace'

const agents = [
  { id: 'specialist', name: 'Security', createdByPrincipalId: 'me' },
  { id: 'peer', name: 'Atlas', createdByPrincipalId: 'peer', agentRole: 'personal_chief' as const, chiefScope: 'workspace' as const },
  { id: 'workspace', name: 'Overlay', createdByPrincipalId: 'me', agentRole: 'workspace_chief' as const },
  { id: 'personal', name: 'Atlas', createdByPrincipalId: 'me', agentRole: 'personal_chief' as const, chiefScope: 'personal' as const },
  { id: 'binding', name: 'Atlas', createdByPrincipalId: 'me', agentRole: 'personal_chief' as const, chiefScope: 'workspace' as const },
]

test('pins chiefs ahead of recent agents without crossing private scope bindings', () => {
  const sorted = sortAgentsByRecency(agents, { peer: 1000, specialist: 2000 })
  assert.deepEqual(pinChiefs(agentsForCreatorScope(sorted, 'me', 'workspace'), 'me').map(a => a.id), ['workspace', 'binding', 'peer'])
  assert.deepEqual(pinChiefs(agentsForCreatorScope(sorted, 'me', 'personal'), 'me').map(a => a.id), ['personal', 'specialist'])
  assert.equal(agentsForCreatorScope(sorted, 'peer', 'personal').some(a => a.id === 'personal'), false)
})

test('display names never decide chief identity or canonical mark', () => {
  assert.equal(usesOverlayMark({ agentRole: 'personal_chief', isDefault: true }), false)
  assert.equal(usesOverlayMark({ agentRole: 'workspace_chief' }), true)
  assert.equal(usesOverlayMark({ agentRole: 'agent' }), false)
  assert.equal(chiefRoleLabel({ agentRole: 'personal_chief' }), 'Personal chief of staff')
})
