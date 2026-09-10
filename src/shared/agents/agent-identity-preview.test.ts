import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyAgentIdentityPreview,
  mergeAgentIdentityPreview,
  type AgentIdentityPreviewDetail,
} from './agent-identity-preview'

const detail: AgentIdentityPreviewDetail = {
  workspaceId: 'workspace-1',
  agentId: 'agent-1',
  principalId: 'principal-1',
  name: 'Updated agent',
  avatarColor: '#2563eb',
  avatarShape: 'blob',
}

test('mergeAgentIdentityPreview creates and overrides an entry while keeping others', () => {
  const existing = new Map([
    ['principal-1', { name: 'Original agent', avatarColor: '#111827', avatarShape: 'circle' }],
    ['principal-2', { name: 'Other agent', avatarColor: '#059669', avatarShape: 'cloud' }],
  ])

  const merged = mergeAgentIdentityPreview(existing, detail)

  assert.deepEqual(merged.get('principal-1'), {
    name: 'Updated agent',
    avatarColor: '#2563eb',
    avatarShape: 'blob',
  })
  assert.deepEqual(merged.get('principal-2'), existing.get('principal-2'))
  assert.deepEqual(mergeAgentIdentityPreview(new Map(), detail).get('principal-1'), {
    name: 'Updated agent',
    avatarColor: '#2563eb',
    avatarShape: 'blob',
  })
  assert.notStrictEqual(merged, existing)
})

test('applyAgentIdentityPreview patches the matching row', () => {
  const agents = [
    { id: 'agent-1', name: 'Original agent', avatarColor: '#111827', avatarShape: 'circle' },
    { id: 'agent-2', name: 'Other agent', avatarColor: '#059669', avatarShape: 'cloud' },
  ]

  const updated = applyAgentIdentityPreview(agents, detail)

  assert.deepEqual(updated, [
    { id: 'agent-1', name: 'Updated agent', avatarColor: '#2563eb', avatarShape: 'blob' },
    agents[1],
  ])
})

test('applyAgentIdentityPreview returns the same reference when there is no match', () => {
  const agents = [{ id: 'agent-2', name: 'Other agent' }]

  assert.strictEqual(applyAgentIdentityPreview(agents, detail), agents)
})
