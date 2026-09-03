import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAgentReplyBlocks,
  buildAgentsDirectoryBlocks,
  buildHelpBlocks,
  manageAgentUrl,
  MANAGE_ACTION_ID,
} from './slack-reply-blocks'

test('manage URL points at the workspace agent editor', () => {
  assert.equal(
    manageAgentUrl({ baseUrl: 'https://overlay.test/', workspaceId: 'w 1', agentId: 'a/1' }),
    'https://overlay.test/app/w/w%201/agents/a%2F1',
  )
})

test('agent reply carries an action-only manage button', () => {
  const built = buildAgentReplyBlocks({ text: '  Hello  ', agentId: 'agent-1' })
  assert.equal(built.fallback, 'Hello')
  assert.equal(built.blocks.length, 2)
  const actions = (built.blocks[1] as { elements: Array<{ action_id: string; value: string; url?: string }> }).elements[0]
  // No `url`: link buttons never dispatch, and the click must arrive as
  // block_actions for the conversion event to be recorded.
  assert.equal(actions?.action_id, MANAGE_ACTION_ID)
  assert.equal(actions?.value, 'agent-1')
  assert.equal(actions?.url, undefined)
})

test('directory caps at twenty agents with an overflow note', () => {
  const agents = Array.from({ length: 25 }, (_, index) => ({
    id: `agent-${index}`,
    workspaceId: 'w',
    principalId: `p-${index}`,
    name: `Agent ${index}`,
    instructions: 'Help.',
    harness: 'overlay',
    modelId: 'm',
    allowedToolIds: [],
    invocationPolicy: 'mention',
    visibility: 'workspace',
    createdByPrincipalId: 'c',
    createdAt: 1,
    updatedAt: 1,
    teamIds: [],
    roomCount: 0,
  })) as never
  const built = buildAgentsDirectoryBlocks({ agents, workspaceId: 'w', baseUrl: 'https://overlay.test' })
  assert.equal(built.blocks.length, 1 + 20 + 1)
  assert.match(built.fallback, /20 workspace agents/)
})

test('help blocks describe the three entry points', () => {
  const built = buildHelpBlocks()
  const text = JSON.stringify(built.blocks)
  assert.match(text, /\/overlay agents/)
  assert.match(text, /\/overlay ask/)
})
