import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { MemoryExtractionService } from './MemoryExtractionService'

test('agent reply extraction writes conservative memories to the agent owner', async () => {
  const created: Array<Record<string, unknown>> = []
  let extractedActor: string | undefined
  const service = new MemoryExtractionService({
    extractor: {
      modelId: 'openrouter/free',
      async extract(args) {
        extractedActor = args.targetActor
        return [{
          confidence: 0.9,
          content: 'The production rollout requires a reversible smoke test.',
          rationale: 'This is a durable delivery constraint.',
          type: 'decision',
        }]
      },
    },
    memories: {
      async list() { return [] },
      async create(args: Record<string, unknown>) { created.push(args); return args },
    },
    runs: {
      async getTurn() {
        return {
          contextMessages: [{ role: 'user', text: 'Make the rollout reversible.' }],
          messageId: 'message-agent',
          projectId: 'project-private-to-human-owner',
          targetActor: 'agent' as const,
          targetText: 'The production rollout requires a reversible smoke test.',
          turnId: 'turn-agent',
          workspaceId: 'workspace-1',
        }
      },
      async startRun() { return 'run-1' },
      async countRunsSince() { return 0 },
      async completeRun() {},
    },
  } as never)

  const result = await service.extractTurn({
    conversationId: 'conversation-1',
    memoryOwnerId: 'agent-memory:agent-1',
    messageId: 'message-agent',
    targetActor: 'agent',
    turnId: 'turn-agent',
    userId: 'billing-user-1',
    workspaceId: 'workspace-1',
  })

  assert.deepEqual(result, { duplicates: 0, extracted: 1, inserted: 1 })
  assert.equal(extractedActor, 'agent')
  assert.equal(created[0]?.userId, 'agent-memory:agent-1')
  assert.equal(created[0]?.actor, 'agent')
  assert.equal(created[0]?.workspaceId, 'workspace-1')
  assert.equal(created[0]?.projectId, undefined)
})
