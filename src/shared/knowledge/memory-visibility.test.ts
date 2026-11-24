import assert from 'node:assert/strict'
import test from 'node:test'
import { agentMemoryOwner, agentMemoryOwnerId } from '../agents/agent-memory'
import { defaultMemoryVisibility } from './memory-visibility'

test('a person’s new memory is theirs unless they say otherwise', () => {
  assert.equal(defaultMemoryVisibility('user_01ABC'), 'owner')
})

test('an agent’s memory stays shared with the workspace', () => {
  assert.equal(defaultMemoryVisibility(agentMemoryOwnerId('agent_1')), undefined)
})

test('a personal Overlay remembers privately for its owner; other agents remember for the workspace', () => {
  const personal = agentMemoryOwner({ id: 'agent_p', agentRole: 'personal_chief', chiefOwnerUserId: 'user_01ABC' })
  assert.equal(personal, 'user_01ABC')
  assert.equal(defaultMemoryVisibility(personal), 'owner')
  const shared = agentMemoryOwner({ id: 'agent_w', agentRole: 'workspace_chief' })
  assert.equal(shared, agentMemoryOwnerId('agent_w'))
  assert.equal(defaultMemoryVisibility(shared), undefined)
  assert.throws(() => agentMemoryOwner({ id: 'agent_p', agentRole: 'personal_chief' }))
})
