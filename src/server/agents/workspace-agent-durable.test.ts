import { beforeEach, expect, test, vi } from 'vitest'
import { prepareWorkspaceAgentTurn } from './workspace-agent-durable'

const mocks = vi.hoisted(() => ({
  getLatestAgentRun: vi.fn(),
  reserve: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({
  getOverlayServerContext: () => ({
    appData: { repositories: { conversations: { getLatestAgentRun: mocks.getLatestAgentRun } } },
    chatUsagePolicy: { reserveForAttempt: mocks.reserve },
  }),
}))
vi.mock('@/server/conversations/ActConversationRepository', () => ({ asConversationId: (id: string) => id }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getLatestAgentRun.mockResolvedValue({ executionEngine: 'overlay_harness' })
})

test('the legacy preparer rejects a native-owned row before legacy preparation or reservation', async () => {
  await expect(prepareWorkspaceAgentTurn({
    actorUserId: 'user', agentId: 'agent', conversationId: 'room', messageId: 'question',
    memoryEnabled: true, runId: 'agent-run', turnMessageId: 'answer', workspaceId: 'workspace',
  })).rejects.toThrow('This room turn is owned by the native Harness workflow.')
  expect(mocks.getLatestAgentRun).toHaveBeenCalledWith({
    agentRunId: 'agent-run', conversationId: 'room', userId: 'user',
  })
  expect(mocks.reserve).not.toHaveBeenCalled()
})
