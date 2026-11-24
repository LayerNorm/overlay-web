import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = process.cwd()

test('workspace agents use participant-scoped room history and persistence', async () => {
  const [service, preparation, contract, convexRoom, delivery] = await Promise.all([
    readFile(`${root}/src/server/agents/workspace-agent-invocation.ts`, 'utf8'),
    readFile(`${root}/src/server/agents/workspace-agent-preparation.ts`, 'utf8'),
    readFile(`${root}/src/server/conversations/ConversationCollaborationRepository.ts`, 'utf8'),
    readFile(`${root}/convex/collaboration/directMessages.ts`, 'utf8'),
    readFile(`${root}/src/server/harness/native-delivery-steps.ts`, 'utf8'),
  ])

  assert.match(service, /collaboration\.getAccessibleConversation/)
  assert.match(service, /collaboration\.listMessages/)
  assert.match(preparation, /loadRoomTurnContext/)
  assert.match(preparation, /buildAgentTurnContext/)
  assert.doesNotMatch(service, /conversations\.getConversationMessages/)
  assert.match(contract, /getAccessibleConversation/)
  assert.match(contract, /listMessages/)
  assert.match(convexRoom, /export const startAgentTurn = mutation/)
  assert.match(convexRoom, /requireAgentAuthor\(ctx, args\)/)
  assert.match(convexRoom, /authorKind: 'agent'/)
  assert.match(delivery, /finalizeAgentMessage/)
  assert.match(delivery, /failAgentMessage/)
  assert.match(service, /reasonCode/)
  assert.match(service, /no_agent_participant/)
})

test('room agent turns use native Harness admission and delivery', async () => {
  const [messageRoute, policy, nativeStart, workflowInput, preparation, delivery, secureModel] = await Promise.all([
    Promise.all([
      readFile(`${root}/src/server/app-api/v1/conversations/message/route.ts`, 'utf8'),
      readFile(`${root}/src/server/agents/start-agent-turns.ts`, 'utf8'),
    ]).then((sources) => sources.join('\n')),
    readFile(`${root}/src/server/authorization/authorization-route-policy.ts`, 'utf8'),
    readFile(`${root}/src/server/harness/native-turn-start.ts`, 'utf8'),
    readFile(`${root}/src/server/harness/native-workflow-input-builder.ts`, 'utf8'),
    readFile(`${root}/src/server/agents/workspace-agent-preparation.ts`, 'utf8'),
    readFile(`${root}/src/server/harness/native-delivery-steps.ts`, 'utf8'),
    readFile(`${root}/src/server/harness/secure-model.ts`, 'utf8'),
  ])

  assert.match(messageRoute, /startNativeHarnessTurn/)
  assert.match(messageRoute, /resolveWorkspaceAgentInvocations/)
  assert.doesNotMatch(messageRoute, /deferAgentReply/)
  assert.doesNotMatch(policy, /conversations\/agent-reply/)
  await assert.rejects(
    readFile(`${root}/src/server/app-api/v1/conversations/agent-reply/route.ts`, 'utf8'),
    'the client-held agent-reply route should be gone',
  )

  assert.match(messageRoute, /if \(turn\.resumed\) (?:continue|return)/)
  assert.match(nativeStart, /prepareNativeHarnessTurn/)
  assert.match(nativeStart, /admissionRepository\.admit/)
  assert.match(nativeStart, /nativeHarnessWorkflow, \[prepared\.workflowInput\]/)
  assert.match(workflowInput, /prepareWorkspaceAgentInputs/)
  assert.match(preparation, /loadRoomTurnContext/)
  assert.match(delivery, /finishNativeHarnessDelivery/)
  assert.match(delivery, /finalizeAgentMessage/)
  assert.match(secureModel, /serializePersonalHarnessAuthentication/)
})

test('an agent reply is persisted as it is generated, not only when it finishes', async () => {
  const [stream, delivery, contract, convexRoom] = await Promise.all([
    readFile(`${root}/src/server/harness/native-model-stream.ts`, 'utf8'),
    readFile(`${root}/src/server/harness/native-delivery-steps.ts`, 'utf8'),
    readFile(`${root}/src/server/conversations/ConversationCollaborationRepository.ts`, 'utf8'),
    readFile(`${root}/convex/collaboration/directMessages.ts`, 'utf8'),
  ])

  assert.match(stream, /createAgentMessageStream/)
  assert.match(stream, /stream\.pushText\(visible, parts\)/)
  assert.match(stream, /store\.appendAgentMessageDelta/)
  assert.match(delivery, /finalizeAgentMessage/)
  assert.match(delivery, /failAgentMessage/)

  for (const method of [
    'startAgentTurn',
    'appendAgentMessageDelta',
    'finalizeAgentMessage',
    'failAgentMessage',
  ]) {
    assert.match(contract, new RegExp(`${method}\\(args`), `contract is missing ${method}`)
    assert.match(convexRoom, new RegExp(`export const ${method} = mutation`), `convex is missing ${method}`)
  }

  // The row opens idempotently through the indexed nonce lookup, preserving the
  // first historical match on retries or replays.
  assert.match(convexRoom, /withIndex\('by_conversationId_clientNonce'[\s\S]*?\)\s*\.first\(\)/)
  // Agent authorization is not relaxed for the streaming path.
  assert.match(convexRoom, /requireAgentAuthor/)
})

test('agent turns run the shared act tool pipeline, not a private subset', async () => {
  const [preparation, tooling] = await Promise.all([
    readFile(`${root}/src/server/agents/workspace-agent-preparation.ts`, 'utf8'),
    readFile(`${root}/src/server/agents/agent-tooling.ts`, 'utf8'),
  ])

  assert.match(tooling, /prepareActTooling/)
  assert.match(preparation, /buildWorkspaceAgentTooling/)
  assert.doesNotMatch(preparation, /buildOverlayToolSet/)
  assert.doesNotMatch(tooling, /buildOverlayToolSet/)
  assert.match(tooling, /accountAllowedToolIds: overlayToolIds/)
})

test('agent turns carry role-tagged messages and loaded context, not a flattened prompt', async () => {
  const [workflowInput, preparation] = await Promise.all([
    readFile(`${root}/src/server/harness/native-workflow-input-builder.ts`, 'utf8'),
    readFile(`${root}/src/server/agents/workspace-agent-preparation.ts`, 'utf8'),
  ])

  assert.match(workflowInput, /messages: prepared\.turnContext\.messages/)
  assert.match(workflowInput, /instructions: buildAgentSystemPrompt/)
  assert.match(preparation, /buildAgentTurnContext/)
  assert.match(preparation, /latestUserText: room\.latestUserText/)
  assert.doesNotMatch(workflowInput, /^\s*prompt: \[/m)
})

test('an agent memory write follows the room it was learned in', async () => {
  const [tooling, preparation, delivery, memoryRoute] = await Promise.all([
    readFile(`${root}/src/server/agents/agent-tooling.ts`, 'utf8'),
    readFile(`${root}/src/server/agents/workspace-agent-preparation.ts`, 'utf8'),
    readFile(`${root}/src/server/harness/native-delivery-steps.ts`, 'utf8'),
    readFile(`${root}/src/server/app-api/v1/memory/route.ts`, 'utf8'),
  ])

  assert.match(tooling, /memoryOwnerForPlace\(\{\s*actorUserId: args\.actorUserId, agent: args\.memoryAgent, workspaceContext: sharedRoom \|\| workspaceMemory,/)
  assert.match(preparation, /memoryAgent: agent/)
  assert.match(delivery, /memoryOwnerId: agentMemoryOwnerId\(access\.agentId\)/)
  assert.match(delivery, /targetActor: 'agent'/)
  assert.match(memoryRoute, /resolveMemoryOwner/)
  assert.match(memoryRoute, /Unknown agent memory owner/)
  assert.match(memoryRoute, /This agent does not keep workspace memories/)
})

test('room memory ingestion is owner-scoped and gated by the message toggle', async () => {
  const [route, preparation, workflowInput, delivery, contract, convexRoom, convexExtractor, convexMemoryQuery] = await Promise.all([
    Promise.all([
      readFile(`${root}/src/server/app-api/v1/conversations/message/route.ts`, 'utf8'),
      // The route hands the turn to this module, which opens the durable run.
      readFile(`${root}/src/server/agents/start-agent-turns.ts`, 'utf8'),
    ]).then((sources) => sources.join('\n')),
    readFile(`${root}/src/server/agents/workspace-agent-preparation.ts`, 'utf8'),
    readFile(`${root}/src/server/harness/native-workflow-input-builder.ts`, 'utf8'),
    readFile(`${root}/src/server/harness/native-delivery-steps.ts`, 'utf8'),
    readFile(`${root}/src/server/conversations/ConversationCollaborationRepository.ts`, 'utf8'),
    readFile(`${root}/convex/collaboration/directMessages.ts`, 'utf8'),
    readFile(`${root}/convex/knowledge/memoryExtractorNode.ts`, 'utf8'),
    readFile(`${root}/convex/knowledge/memoryExtractor.ts`, 'utf8'),
  ])

  assert.match(route, /args\.memoryEnabled && args\.extractHumanMemory !== false && invocations\.length > 0/)
  assert.match(route, /targetActor: 'human'/)
  assert.match(preparation, /memoryEnabled: input\.memoryEnabled/)
  assert.match(workflowInput, /memoryEnabled: args\.memoryEnabled/)
  assert.match(delivery, /targetActor: 'agent'/)
  for (const source of [contract, convexRoom]) {
    assert.match(source, /enqueueMemoryExtraction/)
  }
  // Agent-owned extraction uses its own prompt (M1 memory write path).
  assert.match(convexExtractor, /targetActor === "agent" \? AGENT_MEMORY_EXTRACTION_SYSTEM_PROMPT/)
  assert.match(convexExtractor, /memoryOwnerId/)
  assert.match(convexMemoryQuery, /hasSameMemoryExtractionAuthor\(message, validTarget\)/)
})

// Convex rejects malformed Unicode before the command mutation handler runs.
