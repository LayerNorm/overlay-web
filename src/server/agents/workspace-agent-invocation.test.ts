import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildRemoteAgentPrompt,
  permissionModeForConnectedHarness,
  reconcileUnverifiedAgentActionClaims,
  shouldPrepareConnectedAgentDrive,
} from './workspace-agent-invocation'
import { isExternalAgentInvocation } from './external-agent-policy'

const root = process.cwd()

test('native permission modes are not forwarded, while connected harness values are preserved', () => {
  assert.equal(permissionModeForConnectedHarness('overlay', 'ask'), undefined)
  assert.equal(permissionModeForConnectedHarness('overlay', 'auto'), undefined)
  assert.equal(permissionModeForConnectedHarness('claude-code', 'auto'), 'auto')
  assert.equal(permissionModeForConnectedHarness('claude-code', 'acceptEdits'), 'acceptEdits')
})

test('drive starts require the rollout flag, current host capability and local opt-in', () => {
  const cloud = { enabled: true, environmentKind: 'overlay_cloud', optedIn: false, capabilities: { drive: { version: 1 } } }
  assert.equal(shouldPrepareConnectedAgentDrive(cloud), true)
  assert.equal(shouldPrepareConnectedAgentDrive({ ...cloud, enabled: false }), false)
  assert.equal(shouldPrepareConnectedAgentDrive({ ...cloud, capabilities: {} }), false)
  assert.equal(shouldPrepareConnectedAgentDrive({ ...cloud, capabilities: { drive: { version: 2 } } }), false)
  for (const environmentKind of ['local', 'vps', 'external']) {
    assert.equal(shouldPrepareConnectedAgentDrive({ ...cloud, environmentKind }), false)
    assert.equal(shouldPrepareConnectedAgentDrive({ ...cloud, environmentKind, optedIn: true }), true)
  }
})

test('a legacy external agent with no usable target cannot be classified as native', () => {
  assert.equal(isExternalAgentInvocation({
    id: 'agent-legacy',
    workspaceId: 'workspace-1',
    harness: 'overlay',
    modelId: 'openai/gpt-4.1',
  }, true, false), true)
  assert.equal(isExternalAgentInvocation({
    id: 'agent-native',
    workspaceId: 'workspace-1',
    harness: 'overlay',
    modelId: 'openai/gpt-4.1',
  }, false, false), false)
})

test('agent external-action claims require a successful tool result', () => {
  const corrected = reconcileUnverifiedAgentActionClaims({
    content: 'Done — I saved a note titled "Overlay reference".',
    parts: [{ type: 'text', text: 'Done — I saved a note titled "Overlay reference".' }],
  })
  assert.match(corrected.content, /could not create or save a note/i)
  assert.doesNotMatch(corrected.content, /I saved a note/i)

  const confirmed = reconcileUnverifiedAgentActionClaims({
    content: 'Done — I saved a note titled "Overlay reference".',
    parts: [
      {
        type: 'tool-invocation',
        toolInvocation: {
          toolName: 'create_note',
          toolOutput: { success: true, noteId: 'note_1' },
        },
      },
      { type: 'text', text: 'Done — I saved a note titled "Overlay reference".' },
    ],
  })
  assert.equal(confirmed.content, 'Done — I saved a note titled "Overlay reference".')
})

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
  assert.match(nativeStart, /repository\)\.admit/)
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

  // The row opens idempotently, so a retried or replayed turn reuses it instead
  // of posting the reply twice.
  assert.match(convexRoom, /message\.clientNonce === args\.clientNonce/)
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

test('an agent memory write is owned by the agent, not by whoever summoned it', async () => {
  const [tooling, delivery, memoryRoute] = await Promise.all([
    readFile(`${root}/src/server/agents/agent-tooling.ts`, 'utf8'),
    readFile(`${root}/src/server/harness/native-delivery-steps.ts`, 'utf8'),
    readFile(`${root}/src/server/app-api/v1/memory/route.ts`, 'utf8'),
  ])

  assert.match(tooling, /memoryOwnerId: agentMemoryOwnerId\(args\.grant\.agentId\)/)
  assert.match(delivery, /memoryOwnerId: agentMemoryOwnerId\(access\.agentId\)/)
  assert.match(delivery, /targetActor: 'agent'/)
  assert.match(memoryRoute, /resolveMemoryOwner/)
  assert.match(memoryRoute, /Unknown agent memory owner/)
})

test('connected agents receive bounded memory and room context without confusing it for the request', () => {
  const prompt = buildRemoteAgentPrompt({
    contextBlock: 'Workspace memory: The launch is Friday.',
    messages: [
      { role: 'user', content: 'Maya: Keep the rollout reversible.' },
      { role: 'assistant', content: 'I prepared a rollback checklist.' },
    ],
    prompt: 'What should we verify next?',
  })

  assert.match(prompt, /OVERLAY_CONTEXT_BEGIN/)
  assert.match(prompt, /untrusted background data/)
  assert.match(prompt, /The launch is Friday/)
  assert.match(prompt, /Room participant: Maya/)
  assert.match(prompt, /Agent: I prepared/)
  assert.match(prompt, /CURRENT_USER_MESSAGE_BEGIN\nWhat should we verify next\?\nCURRENT_USER_MESSAGE_END/)

  const oversized = buildRemoteAgentPrompt({
    contextBlock: 'x'.repeat(100_000),
    messages: [],
    prompt: 'The current request must survive truncation.',
  })
  assert.match(oversized, /\[Overlay context truncated\]/)
  assert.match(oversized, /The current request must survive truncation/)
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
test('remote history truncation cannot break the next turn after an emoji reply', () => {
  const prompt = buildRemoteAgentPrompt({
    contextBlock: '',
    messages: [{ role: 'assistant', content: 'a'.repeat(1999) + '🙂' + 'tail'.repeat(300000) }],
    prompt: 'Continue the task',
  })
  assert.equal(prompt.isWellFormed(), true)
  assert.ok(prompt.includes('a'.repeat(1999)))
  assert.ok(prompt.includes('CURRENT_USER_MESSAGE_BEGIN\nContinue the task\nCURRENT_USER_MESSAGE_END'))
})

test('the total remote context limit preserves complete Unicode characters', () => {
  const empty = buildRemoteAgentPrompt({ contextBlock: '', messages: [], prompt: 'Continue' })
  const prefixLength = empty.indexOf('OVERLAY_CONTEXT_END')
  // The nonempty block replaces the end marker after the same envelope prefix.
  const contextStart = prefixLength
  const contextBlock = 'a'.repeat(79999 - contextStart) + '🙂' + 'b'.repeat(100)
  const prompt = buildRemoteAgentPrompt({ contextBlock, messages: [], prompt: 'Continue' })
  assert.equal(prompt.isWellFormed(), true)
  assert.match(prompt, /Overlay context truncated/)
  assert.match(prompt, /CURRENT_USER_MESSAGE_BEGIN\nContinue\nCURRENT_USER_MESSAGE_END/)
})
