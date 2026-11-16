import assert from 'node:assert/strict'
import test from 'node:test'
import { memoryFields } from './route'

test('an automation tool call forwards only memory fields to the memory service', () => {
  // save_memory from an automation also sends the caller fields; Convex's
  // memories:add rejects any field it does not name (e.g. automationId).
  const fields = memoryFields({
    content: 'Remember this', source: 'chat', importance: 3, tags: ['qa'], conversationId: 'c', turnId: 't',
    memoryOwnerId: 'agent-memory:agent_1', userId: 'user_1', accessToken: 'token', automationId: 'automation_1',
  })
  assert.deepEqual(fields, {
    content: 'Remember this', source: 'chat', importance: 3, tags: ['qa'], conversationId: 'c', turnId: 't',
  })
})
