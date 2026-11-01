import { beforeEach, expect, test, vi } from 'vitest'
import { assertPersistedSurfaceSource, assertSurfaceAdmissionSource } from './surface-access'
import type { SurfaceTurnExecution } from '@/shared/agents/surface-turn-execution'

const mocks = vi.hoisted(() => ({ bindings: vi.fn(), workspace: vi.fn(), conversation: vi.fn(), run: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  surfaceService: { resolveInboundBindings: mocks.bindings },
  workspaceService: { resolveActiveWorkspace: mocks.workspace },
  appData: { repositories: { conversations: { getConversationById: mocks.conversation, getLatestAgentRun: mocks.run } } },
}) }))
vi.mock('@/server/conversations/ActConversationRepository', () => ({ asConversationId: (id: string) => id }))

const execution: SurfaceTurnExecution = {
  turnId: 'surface:slack:binding:message',
  workflowRunId: 'workflow',
  actorUserId: 'user',
  workspaceId: 'workspace',
  creatorPrincipalId: 'principal',
  agentId: 'agent',
  agentPrincipalId: 'agent-principal',
  platform: 'slack',
  teamId: 'team',
  channelId: 'channel',
  threadId: 'thread',
  messageId: 'message',
  bindingId: 'binding',
  connectionId: 'connection',
  conversationId: 'conversation',
  agentRunId: 'delivery',
  userMessageId: 'question',
  assistantMessageId: 'answer',
  harnessRunId: 'workspace:delivery',
  placeholderTs: 'placeholder',
  createdAt: 100,
  updatedAt: 100,
}
const source = {
  binding: { id: 'binding', connectionId: 'connection', channelId: 'channel', agentId: 'agent', status: 'active' },
  connection: { id: 'connection', platform: 'slack', externalTeamId: 'team', workspaceId: 'workspace', status: 'active' },
  agent: { id: 'agent', principalId: 'agent-principal', harness: 'overlay', allowedToolIds: ['read_file'], permissionMode: 'ask' },
  creatorUserId: 'user',
  creatorPrincipalId: 'principal',
}
const conversation = {
  userId: 'user',
  workspaceId: 'workspace',
  conversationType: 'channel',
  createdByPrincipalId: 'principal',
  externalPlatform: 'slack',
  externalChannelId: 'channel',
  externalThreadId: 'thread',
  surfaceBindingId: 'binding',
}
const run = {
  id: 'delivery',
  userId: 'user',
  conversationId: 'conversation',
  agentId: 'agent',
  agentPrincipalId: 'agent-principal',
  initiatorPrincipalId: 'principal',
  turnId: execution.turnId,
  userMessageId: 'question',
  assistantMessageId: 'answer',
  harnessRunId: 'workspace:delivery',
  workflowRunId: undefined,
  mode: 'room',
  runner: 'workflow',
  executionEngine: 'overlay_harness',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.bindings.mockResolvedValue([source])
  mocks.workspace.mockResolvedValue({ workspace: { id: 'workspace' }, principal: { id: 'principal' } })
  mocks.conversation.mockResolvedValue(conversation)
  mocks.run.mockResolvedValue(run)
})

test('fresh source admission validates the active binding, team, workspace, and creator', async () => {
  await expect(assertSurfaceAdmissionSource({
    actorUserId: 'user',
    workspaceId: 'workspace',
    turnId: execution.turnId,
    surface: {
      platform: 'slack',
      bindingId: execution.bindingId,
      connectionId: execution.connectionId,
      teamId: execution.teamId,
      channelId: execution.channelId,
      threadId: execution.threadId,
      messageId: execution.messageId,
      agentId: execution.agentId,
      agentPrincipalId: execution.agentPrincipalId,
      creatorPrincipalId: execution.creatorPrincipalId,
    },
  })).resolves.toEqual(source)
  expect(mocks.bindings).toHaveBeenCalledWith({ platform: 'slack', externalTeamId: 'team', channelId: 'channel' })
  mocks.bindings.mockResolvedValueOnce([{ ...source, connection: { ...source.connection, externalTeamId: 'other-team' } }])
  await expect(assertSurfaceAdmissionSource({
    actorUserId: 'user', workspaceId: 'workspace', turnId: execution.turnId,
    surface: {
      platform: 'slack',
      bindingId: execution.bindingId,
      connectionId: execution.connectionId,
      teamId: execution.teamId,
      channelId: execution.channelId,
      threadId: execution.threadId,
      messageId: execution.messageId,
      agentId: execution.agentId,
    },
  })).rejects.toThrow('authorization')
})

test('persisted source validates the exact native room conversation and root delivery', async () => {
  await expect(assertPersistedSurfaceSource(execution, 'workflow')).resolves.toMatchObject({
    source,
    conversation,
    run: { id: 'delivery', mode: 'room', executionEngine: 'overlay_harness' },
  })
  expect(mocks.conversation).toHaveBeenCalledWith({
    conversationId: 'conversation',
    userId: 'user',
    workspaceId: 'workspace',
  })
  mocks.conversation.mockResolvedValueOnce({ ...conversation, externalThreadId: 'other-thread' })
  await expect(assertPersistedSurfaceSource(execution, 'workflow')).rejects.toThrow('conversation ownership')
  await expect(assertPersistedSurfaceSource(execution, 'foreign-workflow')).rejects.toThrow('identity')
})

test('persisted source rejects mismatched actor, assistant, run, or workflow ownership', async () => {
  mocks.run.mockResolvedValueOnce({ ...run, userId: 'other-user' })
  await expect(assertPersistedSurfaceSource(execution, 'workflow')).rejects.toThrow('delivery ownership')
  mocks.run.mockResolvedValueOnce({ ...run, assistantMessageId: 'other-answer' })
  await expect(assertPersistedSurfaceSource(execution, 'workflow')).rejects.toThrow('delivery ownership')
  mocks.run.mockResolvedValueOnce({ ...run, workflowRunId: 'foreign-workflow' })
  await expect(assertPersistedSurfaceSource(execution, 'workflow')).rejects.toThrow('delivery ownership')
})
