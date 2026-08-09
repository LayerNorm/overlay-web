import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = process.cwd()

test('workspace agents use participant-scoped room history and persistence', async () => {
  const [service, contract, convexRoom] = await Promise.all([
    readFile(`${root}/src/server/agents/workspace-agent-invocation.ts`, 'utf8'),
    readFile(`${root}/src/server/conversations/ConversationCollaborationRepository.ts`, 'utf8'),
    readFile(`${root}/convex/collaboration/directMessages.ts`, 'utf8'),
  ])

  assert.match(service, /collaboration\.getAccessibleConversation/)
  assert.match(service, /collaboration\.listMessages/)
  assert.match(service, /collaboration\.addAgentMessage/)
  assert.doesNotMatch(service, /conversations\.getConversationMessages/)
  assert.match(contract, /addAgentMessage/)
  assert.match(convexRoom, /export const addAgentMessage/)
  assert.match(convexRoom, /AGENT_PARTICIPANT_REQUIRED/)
  assert.match(convexRoom, /authorKind: 'agent'/)
})
