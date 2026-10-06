import assert from 'node:assert/strict'
import test from 'node:test'
import { agentMemoryOwnerId } from '../agents/agent-memory'
import { defaultMemoryVisibility } from './memory-visibility'

test('a person’s new memory is theirs unless they say otherwise', () => {
  assert.equal(defaultMemoryVisibility('user_01ABC'), 'owner')
})

test('an agent’s memory stays shared with the workspace', () => {
  assert.equal(defaultMemoryVisibility(agentMemoryOwnerId('agent_1')), undefined)
})
