import { beforeEach, expect, test, vi } from 'vitest'
import { buildAgentTurnContext } from './agent-turn-context'

const mocks = vi.hoisted(() => ({
  memories: vi.fn(),
  profile: vi.fn(),
  skills: vi.fn(),
  retrieval: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({
  getOverlayServerContext: () => ({
    appData: { repositories: { conversations: {
      listMemories: mocks.memories,
      getMemoryProfile: mocks.profile,
      listSkillDirectory: mocks.skills,
    } } },
  }),
}))
vi.mock('@/server/knowledge/ask-knowledge-context', () => ({
  buildAutoRetrievalBundle: mocks.retrieval,
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.memories.mockResolvedValue([])
  mocks.skills.mockResolvedValue([])
})

test('a single-human assignment child cannot regain personal resources from a shared parent', async () => {
  await buildAgentTurnContext({
    actorUserId: 'human',
    agentName: 'Specialist',
    agentPrincipalId: 'specialist',
    conversationType: 'dm',
    conversationTitle: 'Assignment',
    history: [],
    idempotencyKey: 'assignment-context',
    latestUserText: 'Do the task',
    memoryEnabled: true,
    participants: [
      { displayName: 'Requester', principalId: 'human', principalType: 'human' },
      { displayName: 'Specialist', principalId: 'specialist', principalType: 'agent' },
      { displayName: 'Chief', principalId: 'chief', principalType: 'agent' },
    ],
    requestFingerprint: 'assignment-request',
    workspaceId: 'workspace',
    includeAutoRetrieval: true,
    inheritedSharedRoom: true,
  })

  expect(mocks.memories).toHaveBeenCalledWith({
    userId: 'human', workspaceId: 'workspace', workspaceOnly: true,
  })
  expect(mocks.profile).not.toHaveBeenCalled()
  expect(mocks.skills).toHaveBeenCalledWith({
    userId: 'human', workspaceId: 'workspace', workspaceOnly: true,
  })
  expect(mocks.retrieval).not.toHaveBeenCalled()
})
