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
  const [service, contract, convexRoom, route] = await Promise.all([
    readFile(`${root}/src/server/agents/workspace-agent-invocation.ts`, 'utf8'),
    readFile(`${root}/src/server/conversations/ConversationCollaborationRepository.ts`, 'utf8'),
    readFile(`${root}/convex/collaboration/directMessages.ts`, 'utf8'),
    readFile(`${root}/src/server/app-api/v1/conversations/agent-reply/route.ts`, 'utf8'),
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
  assert.match(route, /reasonCode: error\.reasonCode/)
  assert.match(route, /message: error\.message/)
  assert.doesNotMatch(route, /signal: request\.signal/)
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
