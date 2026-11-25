import assert from 'node:assert/strict'
import test from 'node:test'
import { chiefRoleLabel, pinChiefs, usesOverlayMark } from './chief-identity'
import { agentsForMode, sortAgentsByRecency } from './last-agent-by-workspace'

const agents = [
  { id: 'specialist', name: 'Security', createdByPrincipalId: 'me', visibility: 'creator' as const },
  { id: 'shared', name: 'Scout', createdByPrincipalId: 'peer', visibility: 'workspace' as const },
  { id: 'peer', name: 'Atlas', createdByPrincipalId: 'peer', agentRole: 'personal_chief' as const, chiefScope: 'workspace' as const },
  { id: 'workspace', name: 'Overlay', createdByPrincipalId: 'me', agentRole: 'workspace_chief' as const },
  { id: 'personal', name: 'Atlas', createdByPrincipalId: 'me', agentRole: 'personal_chief' as const, chiefScope: 'personal' as const },
  { id: 'binding', name: 'Atlas', createdByPrincipalId: 'me', agentRole: 'personal_chief' as const, chiefScope: 'workspace' as const },
]

test('pins the chief of each mode ahead of recent agents; personal chiefs never appear in Workspace', () => {
  const sorted = sortAgentsByRecency(agents, { shared: 1000, specialist: 2000 })
  assert.deepEqual(pinChiefs(agentsForMode(sorted, 'me', 'workspace'), 'me').map(a => a.id), ['workspace', 'shared'])
  // Only the viewer's own Personal Chief is Personal; a workspace-bound legacy chief and another person's never show.
  assert.deepEqual(pinChiefs(agentsForMode(sorted, 'me', 'personal'), 'me').map(a => a.id), ['personal', 'specialist'])
  assert.equal(agents.some(a => a.id === 'binding' && (agentsForMode(agents, 'me', 'personal').includes(a) || agentsForMode(agents, 'me', 'workspace').includes(a))), false)
  assert.equal(agentsForMode(sorted, 'peer', 'personal').some(a => a.id === 'personal'), false)
  assert.equal(agentsForMode(sorted, 'peer', 'workspace').some(a => a.agentRole === 'personal_chief'), false)
})

test('display names never decide chief identity or canonical mark', () => {
  assert.equal(usesOverlayMark({ agentRole: 'personal_chief', isDefault: true }), false)
  assert.equal(usesOverlayMark({ agentRole: 'workspace_chief' }), true)
  assert.equal(usesOverlayMark({ agentRole: 'agent' }), false)
  assert.equal(chiefRoleLabel({ agentRole: 'personal_chief' }), 'Personal chief of staff')
})
