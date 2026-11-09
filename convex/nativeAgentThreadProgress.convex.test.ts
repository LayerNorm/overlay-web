import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import schema from './schema'
import { projectNativePersonalProgress } from './lib/nativePersonalProgress'

const modules = import.meta.glob('./**/*.ts')

// Agent threads (room deliveries) keep the person's turn id on their message and
// the agent's turn id on the reply. Their settled steps must still project.
test('an agent thread reply keeps every step\'s text in order', async () => {
  const convex = convexTest(schema, modules)
  const now = Date.now()
  const runId = 'workspace:agent-thread'
  const result = await convex.run(async ctx => {
    const conversationId = await ctx.db.insert('conversations', {
      userId: 'owner', workspaceId: 'ws', title: 'Thread', lastModified: now, createdAt: now, updatedAt: now,
      lastMode: 'act', askModelIds: ['model'], actModelId: 'model', conversationType: 'dm',
    })
    const userMessageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', turnId: 'human_turn', role: 'user', mode: 'act', authorKind: 'human',
      content: 'Request', contentType: 'text', status: 'completed', createdAt: now, updatedAt: now,
    })
    const assistantMessageId = await ctx.db.insert('conversationMessages', {
      conversationId, userId: 'owner', turnId: 'agent_turn', role: 'assistant', mode: 'act',
      authorKind: 'agent', authorPrincipalId: 'agent-principal',
      content: '', contentType: 'text', status: 'generating', createdAt: now, updatedAt: now,
    })
    const deliveryId = await ctx.db.insert('conversationAgentRuns', {
      conversationId, turnId: 'agent_turn', userId: 'owner', userMessageId, assistantMessageId,
      mode: 'room', runner: 'workflow', executionEngine: 'overlay_harness', status: 'running',
      harnessRunId: runId, workflowRunId: 'workflow', agentId: 'agent', agentPrincipalId: 'agent-principal',
      createdAt: now, updatedAt: now,
    })
    const runRowId = await ctx.db.insert('harnessRuns', {
      runId, actorUserId: 'owner', rootRunId: runId, deliveryAgentRunId: deliveryId,
      activeDescendantCount: 0, sourceJson: '{}', admissionJson: '{}', metadataJson: '{}',
      createdAt: now, updatedAt: now,
    })
    const steps = [
      { content: 'First, I will search memory.', parts: [
        { type: 'text', text: 'First, I will search memory.' },
        { type: 'tool-invocation', toolInvocation: { toolCallId: 'a', toolName: 'search_memory', state: 'output-available', toolInput: {}, toolOutput: {} } },
      ] },
      { content: 'Found 12 memories. Next, notes.', parts: [
        { type: 'text', text: 'Found 12 memories. Next, notes.' },
        { type: 'tool-invocation', toolInvocation: { toolCallId: 'b', toolName: 'list_notes', state: 'output-available', toolInput: {}, toolOutput: {} } },
      ] },
    ]
    for (const [sequence, persistence] of steps.entries()) {
      await ctx.db.insert('harnessTranscriptSteps', {
        runId, receiptId: `model:${sequence}`, sequence, stepNumber: 0,
        persistenceJson: JSON.stringify(persistence), createdAt: now,
      } as never)
    }
    const run = (await ctx.db.get(runRowId))!
    await projectNativePersonalProgress(ctx, run, {
      workflowRunId: 'workflow', status: 'running', executionGeneration: 0,
      policy: { workspaceId: 'ws', publicStreamVersion: 1 } as never,
    }, 1)
    return await ctx.db.get(assistantMessageId)
  })
  expect(result?.nativeProgressSequence).toBe(1)
  expect(result?.publicStreamCheckpoint?.receiptId).toBe('model:1')
  expect(result?.parts?.map(part => part.type === 'text' ? part.text : part.type)).toEqual([
    'First, I will search memory.', 'tool-invocation', 'Found 12 memories. Next, notes.', 'tool-invocation',
  ])
})
