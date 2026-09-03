import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import {
  defaultAgent,
  parseOverlayCommand,
  resolveMentionedAgent,
} from './slack-agent-resolution'

function agentFixture(overrides: Partial<WorkspaceAgentDirectoryItem> = {}): WorkspaceAgentDirectoryItem {
  return {
    id: 'agent-1',
    workspaceId: 'workspace-1',
    principalId: 'agent-principal-1',
    name: 'Scout',
    description: 'Finds evidence',
    instructions: 'Help.',
    harness: 'overlay',
    modelId: 'test-model',
    allowedToolIds: [],
    invocationPolicy: 'mention',
    visibility: 'workspace',
    createdByPrincipalId: 'principal-1',
    createdAt: 1,
    updatedAt: 1,
    teamIds: [],
    roomCount: 0,
    ...overrides,
  }
}

const MASTER = agentFixture({ id: 'agent-master', principalId: 'agent-principal-master', name: 'Overlay', isDefault: true })
const SCOUT = agentFixture()
const WRITER = agentFixture({ id: 'agent-writer', principalId: 'agent-principal-writer', name: 'Launch writer' })

test('mention resolves the longest agent name opening the text', () => {
  const agents = [MASTER, SCOUT, WRITER]
  assert.equal(
    resolveMentionedAgent({ text: '<@Ubot> launch writer, draft this', visibleAgents: agents })?.id,
    'agent-writer',
  )
  assert.equal(
    resolveMentionedAgent({ text: '<@Ubot> scout: summarize', visibleAgents: agents })?.id,
    'agent-1',
  )
})

test('mention falls back to the default agent on no match', () => {
  assert.equal(
    resolveMentionedAgent({ text: '<@Ubot> hello there', visibleAgents: [MASTER, SCOUT] })?.id,
    'agent-master',
  )
})

test('mention needs a word boundary after the name', () => {
  // "scouting" must not match "Scout" — it falls back to default instead.
  assert.equal(
    resolveMentionedAgent({ text: '<@Ubot> scouting report', visibleAgents: [MASTER, SCOUT] })?.id,
    'agent-master',
  )
})

test('mention resolves nothing without visible agents', () => {
  // A non-creator whose workspace holds only someone else's creator-only
  // agents gets an empty directory: silence, not an error.
  assert.equal(resolveMentionedAgent({ text: '<@Ubot> scout', visibleAgents: [] }), null)
})

test('default agent prefers the master, then first listed', () => {
  assert.equal(defaultAgent([SCOUT, MASTER])?.id, 'agent-master')
  assert.equal(defaultAgent([SCOUT, WRITER])?.id, 'agent-1')
  assert.equal(defaultAgent([]), null)
})

test('slash parsing routes agents, ask, and help', () => {
  assert.deepEqual(parseOverlayCommand({ command: '/overlay', text: '' }), { action: 'agents' })
  assert.deepEqual(parseOverlayCommand({ command: '/overlay', text: 'agents' }), { action: 'agents' })
  assert.deepEqual(
    parseOverlayCommand({ command: '/overlay', text: 'ask scout summarize this' }),
    { action: 'ask', query: 'scout summarize this' },
  )
  assert.deepEqual(parseOverlayCommand({ command: '/overlay', text: 'dance' }), { action: 'help' })
  assert.deepEqual(parseOverlayCommand({ command: '/other', text: '' }), { action: 'help' })
})
