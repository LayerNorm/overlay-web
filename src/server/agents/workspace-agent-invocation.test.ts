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
  const [service, contract, convexRoom] = await Promise.all([
    readFile(`${root}/src/server/agents/workspace-agent-invocation.ts`, 'utf8'),
    readFile(`${root}/src/server/conversations/ConversationCollaborationRepository.ts`, 'utf8'),
    readFile(`${root}/convex/collaboration/directMessages.ts`, 'utf8'),
  ])

  assert.match(service, /collaboration\.getAccessibleConversation/)
  assert.match(service, /collaboration\.listMessages/)
  assert.match(service, /collaboration\.addAgentMessage/)
  assert.match(service, /buildAssistantPersistenceFromSteps/)
  assert.match(service, /parts: assistantPersistence\.parts/)
  assert.doesNotMatch(service, /conversations\.getConversationMessages/)
  assert.match(contract, /addAgentMessage/)
  assert.match(convexRoom, /export const addAgentMessage/)
  assert.match(convexRoom, /AGENT_PARTICIPANT_REQUIRED/)
  assert.match(convexRoom, /authorKind: 'agent'/)
  assert.match(service, /reasonCode/)
  assert.match(service, /no_agent_participant/)
})

test('a room agent turn is owned by a durable run, not by an HTTP request', async () => {
  const [workflow, lifecycle, durable, usage, loop, approval, messageRoute, policy, service] = await Promise.all([
    readFile(`${root}/src/server/workflows/workspace-agent-turn.ts`, 'utf8'),
    readFile(`${root}/src/server/agents/workspace-agent-turn-lifecycle.ts`, 'utf8'),
    readFile(`${root}/src/server/agents/workspace-agent-durable.ts`, 'utf8'),
    readFile(`${root}/src/server/agents/workspace-agent-usage.ts`, 'utf8'),
    readFile(`${root}/src/server/agents/workspace-agent-turn-loop.ts`, 'utf8'),
    readFile(`${root}/src/server/workflows/workspace-agent-approval.ts`, 'utf8'),
    Promise.all([
      readFile(`${root}/src/server/app-api/v1/conversations/message/route.ts`, 'utf8'),
      // The route hands the turn to this module, which opens the durable run.
      readFile(`${root}/src/server/agents/start-agent-turns.ts`, 'utf8'),
    ]).then((sources) => sources.join('\n')),
    readFile(`${root}/src/server/authorization/authorization-route-policy.ts`, 'utf8'),
    readFile(`${root}/src/server/agents/workspace-agent-invocation.ts`, 'utf8'),
  ])

  // Saving the human message is what starts the turn. The browser cannot be
  // the trigger any more, which is what made closing the tab end the reply.
  assert.match(messageRoute, /start\(workspaceAgentTurnWorkflow/)
  assert.match(messageRoute, /resolveWorkspaceAgentInvocations/)
  assert.doesNotMatch(messageRoute, /deferAgentReply/)
  assert.doesNotMatch(policy, /conversations\/agent-reply/)
  await assert.rejects(
    readFile(`${root}/src/server/app-api/v1/conversations/agent-reply/route.ts`, 'utf8'),
    'the client-held agent-reply route should be gone',
  )

  // A duplicate trigger must not bill the same reply twice.
  assert.match(messageRoute, /if \(turn\.resumed\) (?:continue|return)/)

  assert.match(workflow, /'use workflow'/)
  for (const step of [
    'attachWorkspaceAgentRun',
    'prepareWorkspaceAgentTurn',
    'callWorkspaceAgentModel',
    'inspectWorkspaceAgentTool',
    'executeWorkspaceAgentTool',
    'persistWorkspaceAgentToolProgress',
    'finalizeWorkspaceAgentTurn',
    'completeWorkspaceAgentRun',
    'failWorkspaceAgentRun',
  ]) {
    assert.match(workflow, new RegExp(step), `workflow is missing ${step}`)
    assert.match(lifecycle, new RegExp(step), `lifecycle is missing ${step}`)
  }
  for (const step of [
    'prepareWorkspaceAgentTurn',
    'callWorkspaceAgentModel',
    'inspectWorkspaceAgentTool',
    'executeWorkspaceAgentTool',
    'persistWorkspaceAgentToolProgress',
    'finalizeWorkspaceAgentTurn',
  ]) {
    assert.match(durable, new RegExp(`export async function ${step}[\\s\\S]*?'use step'`), `${step} must be durable`)
  }
  for (const step of ['settleWorkspaceAgentUsage', 'releaseWorkspaceAgentReservation']) {
    assert.match(usage, new RegExp(`export async function ${step}[\\s\\S]*?'use step'`), `${step} must be durable`)
    assert.match(lifecycle, new RegExp(`export const ${step}`), `${step} must be registered in the lifecycle`)
  }
  assert.match(approval, /hook\.getConflict\(\)/)
  assert.match(approval, /sleep\('15m'\)/)
  assert.match(workflow, /resumeWorkspaceAgentAfterApproval/)
  assert.match(workflow, /runWorkspaceAgentTurnLoop/)
  assert.match(workflow, /callModel: callWorkspaceAgentModel/)
  assert.match(workflow, /inspectTool: inspectWorkspaceAgentTool/)
  assert.match(workflow, /executeTool: executeWorkspaceAgentTool/)
  assert.match(loop, /if \(!decision\.approved\)/)
  assert.match(durable, /refusedAmbiguousWorkspaceAgentToolRetry\(getStepMetadata\(\)\.attempt, input\.toolCall\.toolName\)/)
  assert.match(durable, /idempotencyKey: `\$\{input\.prepared\.runId\}:\$\{input\.toolCall\.toolCallId\}`/)
  assert.equal(workflow.match(/callModel: callWorkspaceAgentModel/g)?.length, 1)
  assert.equal(workflow.match(/executeTool: executeWorkspaceAgentTool/g)?.length, 1)
  assert.match(loop, /for \(const toolCall of call\.toolCalls\)/)
  assert.doesNotMatch(workflow, /executeWorkspaceAgentTurn\(/)

  // A durable turn outlives the request that triggered it, so it must not
  // depend on that request's credential.
  assert.doesNotMatch(lifecycle, /accessToken/)
  // Resolution and execution are separate so the trigger can return without
  // waiting for any turn to finish.
  assert.match(service, /export async function resolveWorkspaceAgentInvocations/)
  assert.match(service, /export async function runWorkspaceAgentTurn/)
  assert.doesNotMatch(service, /invokeWorkspaceAgentsForHumanMessage/)

  // The turn's own reply row carries the invocation nonce, so the
  // already-replied guard has to exclude it — comparing on the nonce alone
  // makes every durable turn skip itself and reply to nothing.
  assert.match(service, /priorReply\._id !== args\.existingMessageId/)

  // The workflow sandbox cannot use Node built-ins. Keep server imports as
  // steps, except for the pure loop helper that only orchestrates those steps.
  const serverImports = [...workflow.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/server[^']*'/g)]
    .flatMap((match) => match[1]!.split(',').map((name) => name.trim().split(/\s+as\s+/)[0]!))
    .filter((name) => name && !name.startsWith('type ') && name !== 'runWorkspaceAgentTurnLoop')
  assert.ok(serverImports.length > 0)
  for (const imported of serverImports) {
    assert.match(
      `${lifecycle}\n${durable}\n${usage}`,
      new RegExp(`export async function ${imported}\\b[\\s\\S]*?'use step'`),
      `${imported} is imported into the workflow but is not a step`,
    )
  }
  assert.doesNotMatch(`${loop}\n${await readFile(`${root}/src/server/agents/workspace-agent-turn-utils.ts`, 'utf8')}`, /from ['"]node:|require\(|process\./)
  assert.match(workflow, /function describeWorkspaceAgentFailure/)
})

test('an agent reply is persisted as it is generated, not only when it finishes', async () => {
  const [service, contract, convexRoom] = await Promise.all([
    readFile(`${root}/src/server/agents/workspace-agent-invocation.ts`, 'utf8'),
    readFile(`${root}/src/server/conversations/ConversationCollaborationRepository.ts`, 'utf8'),
    readFile(`${root}/convex/collaboration/directMessages.ts`, 'utf8'),
  ])

  // The turn writes into a `generating` row rather than holding the reply in
  // the response stream, which is what lets it survive the sender's tab.
  assert.match(service, /createAgentMessageStream/)
  assert.match(service, /turnStream\.pushText\(event\.text,\s*liveParts\.map/)
  assert.match(service, /turnStream\.finalize\(/)
  // A turn that dies partway must not leave a row generating forever.
  assert.match(service, /await agentStream\?\.fail\(\)/)
  // The single terminal write stays as the fallback for a failed open.
  assert.match(service, /collaboration\.addAgentMessage/)

  for (const method of [
    'startAgentMessage',
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
  const [invocation, tooling] = await Promise.all([
    readFile(`${root}/src/server/agents/workspace-agent-invocation.ts`, 'utf8'),
    readFile(`${root}/src/server/agents/agent-tooling.ts`, 'utf8'),
  ])

  // Agents must inherit connected apps, MCP, and web search by going through
  // the same builder personal chat uses. Reaching for buildOverlayToolSet here
  // is what left agents years behind the act route the first time.
  assert.match(tooling, /prepareActTooling/)
  assert.doesNotMatch(invocation, /buildOverlayToolSet/)
  assert.doesNotMatch(tooling, /buildOverlayToolSet/)
  // The grant enters as account policy so it can only ever narrow.
  assert.match(tooling, /accountAllowedToolIds: overlayToolIds/)
})

test('agent turns carry role-tagged messages and loaded context, not a flattened prompt', async () => {
  const invocation = await readFile(`${root}/src/server/agents/workspace-agent-invocation.ts`, 'utf8')

  assert.match(invocation, /messages: turnContext\.messages/)
  assert.match(invocation, /const systemPrompt = buildAgentSystemPrompt/)
  assert.match(invocation, /system: systemPrompt/)
  assert.match(invocation, /prepareAgentToolRecoveryStep/)
  assert.match(invocation, /Never claim to have used a tool or changed a resource unless the tool call actually ran and returned success/)
  // A single `prompt:` string is the shape that dropped roles, attachments, and
  // every retrieved source on the floor.
  assert.doesNotMatch(invocation, /^\s*prompt: \[/m)
})

test('an agent memory write is owned by the agent, not by whoever summoned it', async () => {
  const [tooling, memoryRoute] = await Promise.all([
    readFile(`${root}/src/server/agents/agent-tooling.ts`, 'utf8'),
    readFile(`${root}/src/server/app-api/v1/memory/route.ts`, 'utf8'),
  ])

  assert.match(tooling, /memoryOwnerId: agentMemoryOwnerId\(args\.grant\.agentId\)/)
  // The owner is validated against the workspace rather than trusted as given.
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
  const [route, service, contract, convexRoom, convexExtractor, convexMemoryQuery] = await Promise.all([
    Promise.all([
      readFile(`${root}/src/server/app-api/v1/conversations/message/route.ts`, 'utf8'),
      // The route hands the turn to this module, which opens the durable run.
      readFile(`${root}/src/server/agents/start-agent-turns.ts`, 'utf8'),
    ]).then((sources) => sources.join('\n')),
    readFile(`${root}/src/server/agents/workspace-agent-invocation.ts`, 'utf8'),
    readFile(`${root}/src/server/conversations/ConversationCollaborationRepository.ts`, 'utf8'),
    readFile(`${root}/convex/collaboration/directMessages.ts`, 'utf8'),
    readFile(`${root}/convex/knowledge/memoryExtractorNode.ts`, 'utf8'),
    readFile(`${root}/convex/knowledge/memoryExtractor.ts`, 'utf8'),
  ])

  assert.match(route, /args\.memoryEnabled && args\.extractHumanMemory !== false && invocations\.length > 0/)
  assert.match(route, /targetActor: 'human'/)
  assert.match(service, /targetActor: 'agent'/)
  assert.match(service, /memoryEnabled: args\.memoryEnabled/)
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
