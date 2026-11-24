import assert from 'node:assert/strict'
import test from 'node:test'
import { agentMemoryOwnerId, memoryOwnerForPlace } from '../agents/agent-memory'
import { defaultMemoryVisibility } from './memory-visibility'

test('a person’s new memory is theirs unless they say otherwise', () => {
  assert.equal(defaultMemoryVisibility('user_01ABC'), 'owner')
})

test('an agent’s memory stays shared with the workspace', () => {
  assert.equal(defaultMemoryVisibility(agentMemoryOwnerId('agent_1')), undefined)
})

test('memories follow the place, not the agent', () => {
  const workspaceAgent = { id: 'agent_w', agentRole: 'agent', visibility: 'workspace' }
  // A workspace agent in a room others can read adds workspace knowledge.
  const shared = memoryOwnerForPlace({ actorUserId: 'user_01ABC', agent: workspaceAgent, workspaceContext: true })
  assert.equal(shared, agentMemoryOwnerId('agent_w'))
  assert.equal(defaultMemoryVisibility(shared), undefined)
  // The same agent in a 1:1 chat remembers privately for the person.
  const private1on1 = memoryOwnerForPlace({ actorUserId: 'user_01ABC', agent: workspaceAgent, workspaceContext: false })
  assert.equal(private1on1, 'user_01ABC')
  assert.equal(defaultMemoryVisibility(private1on1), 'owner')
})

test('an agent only one person can see never makes workspace knowledge', () => {
  const creatorOnly = { id: 'agent_c', agentRole: 'agent', visibility: 'creator' }
  assert.equal(memoryOwnerForPlace({ actorUserId: 'user_01ABC', agent: creatorOnly, workspaceContext: true }), 'user_01ABC')
  const personal = { id: 'agent_p', agentRole: 'personal_chief', chiefOwnerUserId: 'user_owner', visibility: 'creator' }
  assert.equal(memoryOwnerForPlace({ actorUserId: 'user_01ABC', agent: personal, workspaceContext: true }), 'user_owner')
  assert.equal(memoryOwnerForPlace({ actorUserId: 'user_owner', agent: personal, workspaceContext: false }), 'user_owner')
  assert.throws(() => memoryOwnerForPlace({
    actorUserId: 'user_01ABC', agent: { id: 'agent_p', agentRole: 'personal_chief' }, workspaceContext: false,
  }))
})
