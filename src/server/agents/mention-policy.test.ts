import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { resolveInvocableAgents, resolveMentionFirstInvocations } from './mention-policy'

const NOW = 1_800_000_000_000

function agentFixture(overrides: Partial<WorkspaceAgentDirectoryItem> = {}): WorkspaceAgentDirectoryItem {
  return {
    id: 'agent-1',
    workspaceId: 'workspace-1',
    principalId: 'agent-principal-1',
    name: 'Scout',
    description: 'Finds evidence',
    instructions: 'Find primary evidence and cite it.',
    harness: 'overlay',
    modelId: 'test-model',
    allowedToolIds: [],
    invocationPolicy: 'mention',
    visibility: 'workspace',
    createdByPrincipalId: 'principal-creator',
    createdAt: NOW,
    updatedAt: NOW,
    teamIds: [],
    roomCount: 0,
    ...overrides,
  }
}

test('invocable agents keep visible candidates in mention order', async () => {
  const scout = agentFixture({ id: 'agent-scout', principalId: 'principal-scout' })
  const writer = agentFixture({ id: 'agent-writer', principalId: 'principal-writer' })
  const resolved = resolveInvocableAgents({
    candidatePrincipalIds: ['principal-writer', 'principal-scout'],
    visibleAgents: [scout, writer],
  })
  assert.deepEqual(resolved.map((agent) => agent.id), ['agent-writer', 'agent-scout'])
})

test('invocable agents silently drop candidates missing from the visible directory', async () => {
  // A creator-only agent addressed by anyone but its creator never appears in
  // that actor's directory, so the mention resolves to nothing: no run, and
  // no error that could disclose the agent exists.
  const shared = agentFixture({ id: 'agent-shared', principalId: 'principal-shared' })
  const resolved = resolveInvocableAgents({
    candidatePrincipalIds: ['principal-private', 'principal-shared'],
    visibleAgents: [shared],
  })
  assert.deepEqual(resolved.map((agent) => agent.id), ['agent-shared'])
})

test('invocable agents drop archived agents even when they remain listed', async () => {
  const archived = agentFixture({ id: 'agent-old', principalId: 'principal-old', archivedAt: NOW })
  const resolved = resolveInvocableAgents({
    candidatePrincipalIds: ['principal-old'],
    visibleAgents: [archived],
  })
  assert.deepEqual(resolved, [])
})

test('a channel mention of an invisible agent composes to no invocation', async () => {
  const candidates = resolveMentionFirstInvocations({
    authorKind: 'human',
    conversationType: 'channel',
    participants: [
      { principalId: 'principal-author', principalType: 'human' },
      { principalId: 'principal-private', principalType: 'agent' },
    ],
    mentionedPrincipalIds: ['principal-private'],
  })
  assert.deepEqual(candidates, ['principal-private'])
  // The author's visible directory excludes the creator-only agent, so the
  // composed result is empty and the trigger opens no run.
  const resolved = resolveInvocableAgents({ candidatePrincipalIds: candidates, visibleAgents: [] })
  assert.deepEqual(resolved, [])
})
