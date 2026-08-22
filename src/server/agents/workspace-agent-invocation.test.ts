import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { reconcileUnverifiedAgentActionClaims } from './workspace-agent-invocation'

const root = process.cwd()

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
  const [workflow, lifecycle, messageRoute, policy, service] = await Promise.all([
    readFile(`${root}/workflows/workspace-agent-turn.ts`, 'utf8'),
    readFile(`${root}/src/server/agents/workspace-agent-turn-lifecycle.ts`, 'utf8'),
    readFile(`${root}/src/server/app-api/v1/conversations/message/route.ts`, 'utf8'),
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
  assert.match(messageRoute, /if \(turn\.resumed\) continue/)

  assert.match(workflow, /'use workflow'/)
  for (const step of [
    'attachWorkspaceAgentRun',
    'executeWorkspaceAgentTurn',
    'completeWorkspaceAgentRun',
    'failWorkspaceAgentRun',
  ]) {
    assert.match(workflow, new RegExp(step), `workflow is missing ${step}`)
    assert.match(lifecycle, new RegExp(`export async function ${step}`), `lifecycle is missing ${step}`)
  }
  // Every lifecycle hop is a step, or replay cannot resume the turn.
  assert.equal(lifecycle.match(/'use step'/g)?.length, 5)

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

  // Anything a workflow body imports that is not a `"use step"` function gets
  // bundled for the workflow runtime, where Node built-ins do not exist. One
  // plain helper imported from the server pulled `node:crypto` in behind it and
  // failed the build with a hundred errors, so the workflow's only server
  // imports must be steps, and its plain helpers must live in its own module.
  const serverImports = [...workflow.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/server[^']*'/g)]
    .flatMap((match) => match[1]!.split(',').map((name) => name.trim()))
    .filter((name) => name && !name.startsWith('type '))
  assert.ok(serverImports.length > 0)
  for (const imported of serverImports) {
    assert.match(
      lifecycle,
      new RegExp(`export async function ${imported}\\b[\\s\\S]*?'use step'`),
      `${imported} is imported into the workflow but is not a step`,
    )
  }
  assert.match(workflow, /function describeWorkspaceAgentFailure/)
})

test('an agent reply is persisted as it is generated, not only when it finishes', async () => {
  const [service, contract, convexRoom, postgresRoom] = await Promise.all([
    readFile(`${root}/src/server/agents/workspace-agent-invocation.ts`, 'utf8'),
    readFile(`${root}/src/server/conversations/ConversationCollaborationRepository.ts`, 'utf8'),
    readFile(`${root}/convex/collaboration/directMessages.ts`, 'utf8'),
    readFile(`${root}/src/server/conversations/PostgresConversationCollaborationRepository.ts`, 'utf8'),
  ])

  // The turn writes into a `generating` row rather than holding the reply in
  // the response stream, which is what lets it survive the sender's tab.
  assert.match(service, /createAgentMessageStream/)
  assert.match(service, /turnStream\.pushText\(event\.text\)/)
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
    assert.match(postgresRoom, new RegExp(`async ${method}\\(args`), `postgres is missing ${method}`)
  }

  // Both providers open the row idempotently, so a retried or replayed turn
  // reuses it instead of posting the reply twice.
  assert.match(convexRoom, /message\.clientNonce === args\.clientNonce/)
  assert.match(postgresRoom, /eq\(conversationMessages\.clientNonce, args\.clientNonce\)/)
  // Agent authorization is not relaxed for the streaming path.
  assert.match(convexRoom, /requireAgentAuthor/)
  assert.match(postgresRoom, /requireAgentParticipant/)
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
  assert.match(invocation, /system: buildAgentSystemPrompt/)
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
