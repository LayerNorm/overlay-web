import { beforeEach, expect, test, vi } from 'vitest'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'

const mocks = vi.hoisted(() => ({ getServer: vi.fn(), runtimeConfig: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: mocks.getServer }))
vi.mock('@/server/config', () => ({ getOverlayRuntimeConfig: mocks.runtimeConfig }))
vi.mock('@/server/observability/logger', () => ({ logger: { warn: mocks.warn, error: mocks.error } }))

import { resolveWorkspaceAgentInvocations } from '../agents/workspace-agent-invocation'
import { resolveMentionFirstInvocations } from '../agents/mention-policy'

const privateAgent: WorkspaceAgentDirectoryItem = {
  id: 'agent-private', workspaceId: 'workspace', principalId: 'private-principal', name: 'Private QA Agent',
  description: 'Creator-only QA', instructions: 'Check privately.', harness: 'overlay', modelId: 'fixture/model',
  allowedToolIds: [], invocationPolicy: 'mention', visibility: 'creator', createdByPrincipalId: 'human-principal',
  createdAt: 0, updatedAt: 0, teamIds: [], roomCount: 1,
}

const collaboration = {
  getAccessibleConversation: vi.fn(),
  listParticipants: vi.fn(),
  listMessages: vi.fn(),
}
const findInvocationTarget = vi.fn()
const listBindings = vi.fn()
const getEnvironment = vi.fn()
const directory = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  collaboration.getAccessibleConversation.mockResolvedValue({ conversationType: 'channel', workspaceId: 'workspace' })
  collaboration.listParticipants.mockResolvedValue([
    { principalId: 'human-principal', principalType: 'human' },
    { principalId: privateAgent.principalId, principalType: 'agent' },
  ])
  collaboration.listMessages.mockResolvedValue([])
  directory.mockResolvedValue({ agents: [privateAgent] })
  mocks.getServer.mockReturnValue({
    appData: { repositories: {
      conversationCollaboration: collaboration,
      connectedAgents: { findInvocationTarget, listBindings, getEnvironment },
    } },
    workspaceAgentService: { list: directory },
  })
  mocks.runtimeConfig.mockResolvedValue({ features: { connectedAgentDrive: false } })
})

test('a private room participant is filtered before connected-target resolution', async () => {
  expect(resolveMentionFirstInvocations({
    authorKind: 'human',
    conversationType: 'channel',
    participants: [
      { principalId: 'human-principal', principalType: 'human' },
      { principalId: privateAgent.principalId, principalType: 'agent' },
    ],
    mentionedPrincipalIds: [privateAgent.principalId],
  })).toEqual([privateAgent.principalId])

  const invocations = await resolveWorkspaceAgentInvocations({
    actorUserId: 'human', workspaceId: 'workspace', conversationId: 'room', messageId: 'message',
    mentionedPrincipalIds: [privateAgent.principalId],
  }, { sharedSurfaceContext: { surfaceExecution: {} as never } })

  expect(invocations).toEqual([])
  expect(collaboration.listParticipants).toHaveBeenCalledOnce()
  expect(directory).toHaveBeenCalledOnce()
  expect(findInvocationTarget).not.toHaveBeenCalled()
  expect(listBindings).not.toHaveBeenCalled()
  expect(getEnvironment).not.toHaveBeenCalled()
})
