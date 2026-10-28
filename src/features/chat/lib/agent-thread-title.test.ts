import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRenameAgentThread } from './agent-thread-title'

const eligible = {
  agentName: 'Aster',
  hasPriorHumanMessage: false,
  alreadyRequested: false,
  hasSoloAgent: true,
  text: 'Summarize this file',
}

test('agent thread renames are allowed for an unknown title and placeholders', () => {
  assert.equal(shouldRenameAgentThread({ ...eligible, title: null }), true)
  assert.equal(shouldRenameAgentThread({ ...eligible, title: 'New thread' }), true)
  assert.equal(shouldRenameAgentThread({ ...eligible, title: 'New Chat' }), true)
})

test('agent thread renames preserve custom titles and require the first human message', () => {
  assert.equal(shouldRenameAgentThread({ ...eligible, title: 'Planning notes' }), false)
  assert.equal(shouldRenameAgentThread({ ...eligible, title: 'Aster' }), true)
  assert.equal(shouldRenameAgentThread({ ...eligible, title: null, hasPriorHumanMessage: true }), false)
  assert.equal(shouldRenameAgentThread({ ...eligible, title: null, alreadyRequested: true }), false)
  assert.equal(shouldRenameAgentThread({ ...eligible, title: null, hasSoloAgent: false }), false)
  assert.equal(shouldRenameAgentThread({ ...eligible, title: null, text: '   ' }), false)
})
