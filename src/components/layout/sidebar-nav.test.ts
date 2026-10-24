import assert from 'node:assert/strict'
import test from 'node:test'
import { agentHref, agentThreadHref } from './sidebar-nav'

test('agent links keep their explicit Personal or Workspace scope', () => {
  assert.equal(agentHref('/app/agents', 'agent-1', 'personal'), '/app/agents?agent=agent-1&scope=personal')
  assert.equal(agentHref('/app/agents', 'agent-1', 'workspace'), '/app/agents?agent=agent-1&scope=workspace')
  assert.equal(
    agentThreadHref('/app/agents', 'agent-1', 'thread-1', 'personal'),
    '/app/agents?agent=agent-1&id=thread-1&scope=personal',
  )
})

test('agent links without a selected scope do not add a view parameter', () => {
  assert.equal(agentHref('/app/agents', 'agent-1'), '/app/agents?agent=agent-1')
  assert.equal(agentThreadHref('/app/agents', 'agent-1', 'thread-1'), '/app/agents?agent=agent-1&id=thread-1')
})
