import { beforeEach, expect, test, vi } from 'vitest'
import type { Id } from '../../../convex/_generated/dataModel'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { ConvexActConversationRepository } from '@/server/conversations/ConvexActConversationRepository'
import { ConvexConversationCollaborationRepository } from '@/server/conversations/ConvexConversationCollaborationRepository'
import { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'
import {
  NATIVE_RUN_RETIRED_CODE,
  NATIVE_THREAD_COMPATIBILITY_REVISION,
  NATIVE_THREAD_UNAVAILABLE_CODE,
  nativeThreadCompatibilityUnavailable,
} from '@/shared/agents/native-run-retirement'

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/database/lazy-convex', () => ({ lazyConvex: mocks }))
vi.mock('@/server/shared/internal-api-secret', () => ({ getInternalApiSecret: () => 'fixture-secret' }))

const settingsPath = 'platform/uiSettings:getByServer'
const compatibilityPath = 'chat/conversations:getNativeThreadCompatibility'
const personal = new ConvexActConversationRepository()
const room = new ConvexConversationCollaborationRepository()
const harness = new ConvexHarnessRepository()
const identity = { userId: 'owner', conversationId: asConversationId('conversation'), workspaceId: 'workspace' }
const roomIdentity = { actorUserId: identity.userId, conversationId: identity.conversationId, workspaceId: identity.workspaceId }
const messageId = 'message' as Id<'conversationMessages'>
const nativeRun = {
  ...identity, mode: 'chat' as const, runner: 'workflow' as const, executionEngine: 'overlay_harness' as const,
  modelId: 'model', turnId: 'turn', userMessageId: messageId,
}
const nativeRoomTurn = {
  ...roomIdentity, agentId: 'agent', authorPrincipalId: 'agent-principal', clientNonce: 'nonce',
  modelId: 'model', executionEngine: 'overlay_harness' as const, turnId: 'turn', userMessageId: messageId,
}
const root = {
  runId: 'run', goal: 'Complete the task', constraints: [], source: { conversationId: identity.conversationId },
  policy: { actorUserId: 'owner', workspaceId: 'workspace', allowedToolIds: [], requiresPlan: false,
    deadlineAt: Date.now() + 60_000, maxCostMicros: 100, maxParallelChildren: 1, maxDepth: 1 },
}
const ready = { nativeThreadCompatibilityRevision: NATIVE_THREAD_COMPATIBILITY_REVISION }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.mutation.mockResolvedValue(null)
})

test.each([null, {}, { harnessRevision: 'overlay-harness-v1' }, { nativeThreadCompatibilityRevision: 'future' }])(
  'older backends keep history readable without calling a missing compatibility function: %j',
  async settings => {
    const messages = [{ id: 'historic', content: 'Preserved output' }]
    mocks.query.mockImplementation(async (path: string) => {
      if (path === settingsPath) return settings
      if (path === 'chat/conversations:getMessages') return messages
      throw new Error(`Unexpected query: ${path}`)
    })
    await expect(personal.getNativeThreadCompatibility(identity)).resolves.toEqual(nativeThreadCompatibilityUnavailable())
    await expect(personal.getMessages(identity)).resolves.toEqual(messages)
    expect(mocks.query.mock.calls.some(([path]) => path === compatibilityPath)).toBe(false)
  },
)

test('a ready backend supplies exact authorized, thread-scoped compatibility rather than guessed state', async () => {
  const compatibility = { readOnly: true, code: NATIVE_RUN_RETIRED_CODE, message: 'Start a new thread.' }
  mocks.query.mockImplementation(async (path: string) => path === settingsPath ? ready : compatibility)
  await expect(personal.getNativeThreadCompatibility({ ...identity, threadRootMessageId: 'root' })).resolves.toEqual(compatibility)
  expect(mocks.query).toHaveBeenLastCalledWith(compatibilityPath, {
    ...identity, threadRootMessageId: 'root', serverSecret: 'fixture-secret',
  }, { throwOnError: true })
})

test('authorization and backend errors are not disguised as writable or retired threads', async () => {
  for (const failedPath of [settingsPath, compatibilityPath]) {
    const error = new Error('Unauthorized')
    mocks.query.mockImplementation(async (path: string) => {
      if (path === failedPath) throw error
      return ready
    })
    await expect(personal.getNativeThreadCompatibility(identity)).rejects.toBe(error)
  }
})

const writes = [
  ['personal send', () => personal.addMessage({ ...identity, turnId: 'turn', role: 'user', mode: 'act', content: 'Hello', contentType: 'text' })],
  ['personal admission', () => personal.startAgentRun(nativeRun)],
  ['personal delete', () => personal.deleteTurn({ ...identity, turnId: 'turn' })],
  ['generated UI edit', () => personal.updateMessageUiPart({ ...identity, messageId, partId: 'part', data: { answer: 'yes' } })],
  ['room send', () => room.addMessage({ ...roomIdentity, turnId: 'turn', content: 'Hello' })],
  ['room admission', () => room.startAgentTurn(nativeRoomTurn)],
  ['room non-execution post', () => room.addAgentMessage({ ...nativeRoomTurn, messagePurpose: 'greeting', content: 'Hello' })],
  ['room startup error', () => room.recordAgentStartFailure({ ...nativeRoomTurn, content: 'Could not start' })],
  ['room edit', () => room.editMessage({ ...roomIdentity, messageId, content: 'Edited' })],
  ['room delete', () => room.deleteMessage({ ...roomIdentity, messageId })],
  ['Harness admission', () => harness.admit(root)],
  ['surface admission', () => harness.beginSurfaceTurn({ ...nativeRoomTurn, workflowRunId: 'workflow', creatorPrincipalId: 'creator',
    agentPrincipalId: 'agent-principal', platform: 'slack', teamId: 'team', channelId: 'channel', threadId: 'thread',
    messageId, bindingId: 'binding', connectionId: 'connection', userContent: 'Hello' })],
] as const

test.each(writes)('%s cannot persist anything on an older backend', async (_name, write) => {
  mocks.query.mockResolvedValue({ harnessRevision: 'overlay-harness-v1' })
  await expect(write()).rejects.toThrow(NATIVE_THREAD_UNAVAILABLE_CODE)
  expect(mocks.mutation).not.toHaveBeenCalled()
})

test('ready writes still use the database authorization and atomic retirement fence', async () => {
  mocks.query.mockResolvedValue(ready)
  const error = new Error(`${NATIVE_RUN_RETIRED_CODE}: retired`)
  mocks.mutation.mockRejectedValue(error)
  await expect(room.addMessage({ ...roomIdentity, turnId: 'turn', content: 'Hello' })).rejects.toBe(error)
  expect(mocks.mutation).toHaveBeenCalledWith('collaboration/directMessages:addMessage', {
    ...roomIdentity, turnId: 'turn', content: 'Hello', serverSecret: 'fixture-secret', threadRootMessageId: undefined,
  }, { throwOnError: true })
})

test('connected remote admission and existing reply writes do not depend on new native readiness', async () => {
  await personal.startAgentRun({ ...nativeRun, runner: 'remote', executionEngine: undefined })
  await room.appendAgentMessageDelta({ ...roomIdentity, messageId, contentDelta: 'Still working' })
  expect(mocks.query).not.toHaveBeenCalled()
  expect(mocks.mutation).toHaveBeenCalledTimes(2)
})
