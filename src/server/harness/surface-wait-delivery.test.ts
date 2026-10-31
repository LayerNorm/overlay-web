import { beforeEach, expect, test, vi } from 'vitest'
import { projectNativeHarnessWait } from './native-delivery-steps'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  surfaceExecution: vi.fn(),
  delivery: vi.fn(),
  project: vi.fn(),
  assertSource: vi.fn(),
  bindings: vi.fn(),
  post: vi.fn(),
  adapter: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({
  ConvexHarnessRepository: class {
    get = mocks.get
    getSurfaceExecutionByHarnessRunId = mocks.surfaceExecution
    listPendingWaits = vi.fn(async () => [])
  },
}))
vi.mock('./delivery-wait-projection', () => ({ projectHarnessDeliveryWait: mocks.project }))
vi.mock('./surface-access', () => ({ assertPersistedSurfaceSource: mocks.assertSource }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  surfaceService: { resolveInboundBindings: mocks.bindings },
  workspaceService: {},
  appData: { repositories: { conversations: {
    getLatestAgentRun: mocks.delivery,
    getConversationById: vi.fn(),
    transitionAgentRun: vi.fn(),
  } } },
}) }))
vi.mock('@/server/surfaces/slack-reply', () => ({ postSlackAgentMessage: mocks.post }))
vi.mock('@/server/web/app-url', () => ({ getBaseUrl: () => 'https://overlay.example' }))
vi.mock('@/shared/workspaces/routing', () => ({ buildWorkspaceHref: (_workspace: string, path: string) => path }))
vi.mock('@/server/surfaces/chat', () => ({ getSlackAdapter: mocks.adapter }))

const access = {
  actorUserId: 'user',
  runId: 'workspace:delivery',
  workflowRunId: 'workflow',
  workspaceId: 'workspace',
  principalId: 'human',
  agentId: 'agent',
  agentPrincipalId: 'agent-principal',
  conversationId: 'room',
  agentRunId: 'delivery',
  userMessageId: 'question',
  assistantMessageId: 'answer',
  turnId: 'turn',
}
const state = {
  runId: 'workspace:delivery',
  rootRunId: 'workspace:delivery',
  workflowRunId: 'workflow',
  policy: { actorUserId: 'user', workspaceId: 'workspace' },
  status: 'running',
}
const execution = {
  turnId: 'surface:slack:binding:message',
  workflowRunId: 'workflow',
  actorUserId: 'user',
  workspaceId: 'workspace',
  creatorPrincipalId: 'human',
  agentId: 'agent',
  agentPrincipalId: 'agent-principal',
  platform: 'slack',
  teamId: 'team',
  channelId: 'channel',
  threadId: 'thread',
  messageId: 'message',
  bindingId: 'binding',
  connectionId: 'connection',
  conversationId: 'room',
  agentRunId: 'delivery',
  userMessageId: 'question',
  assistantMessageId: 'answer',
  harnessRunId: 'workspace:delivery',
  placeholderTs: 'original-placeholder',
  createdAt: 100,
  updatedAt: 100,
}
const run = {
  id: 'delivery',
  userId: 'user',
  conversationId: 'room',
  agentId: 'agent',
  agentPrincipalId: 'agent-principal',
  turnId: 'turn',
  userMessageId: 'question',
  assistantMessageId: 'answer',
  mode: 'room',
  runner: 'workflow',
  executionEngine: 'overlay_harness',
  harnessRunId: 'workspace:delivery',
  workflowRunId: 'workflow',
  status: 'running',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockResolvedValue(state)
  mocks.surfaceExecution.mockResolvedValue(execution)
  mocks.delivery.mockResolvedValue(run)
  mocks.project.mockResolvedValue('projected')
  mocks.assertSource.mockImplementation(async () => ({
    source: { agent: { name: 'Bound agent display name' } },
    run: { ...run, status: 'waiting_for_input' },
  }))
  mocks.adapter.mockResolvedValue({ postMessage: vi.fn() })
  mocks.post.mockResolvedValue({ posted: true })
})

test('root input wait edits the immutable placeholder with safe Overlay-only instructions', async () => {
  const result = await projectNativeHarnessWait(access, {
    wait: {
      token: 'private-wait-token',
      kind: 'input',
      question: 'private question that must not reach Slack',
      createdAt: 123,
    } as never,
  })
  expect(result).toBe('projected')
  expect(mocks.assertSource).toHaveBeenCalledWith(execution, 'workflow')
  expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({
    teamId: 'team',
    channelId: 'channel',
    threadTs: 'thread',
    agentName: 'Bound agent display name',
    editTs: 'original-placeholder',
  }))
  const text = mocks.post.mock.calls[0][0].text as string
  expect(text).toContain('needs input in Overlay')
  expect(text).toContain('Slack replies will not resume')
  expect(text).not.toContain('private-wait-token')
  expect(text).not.toContain('private question')
})

test('revoked source and child waits never send a Slack notification', async () => {
  mocks.assertSource.mockRejectedValueOnce(new Error('revoked'))
  expect(await projectNativeHarnessWait(access, { status: 'running' })).toBe('projected')
  expect(mocks.post).not.toHaveBeenCalled()

  const childAccess = { ...access, runId: 'workspace:child', agentRunId: 'child' }
  const childState = { ...state, runId: 'workspace:child', rootRunId: 'workspace:delivery' }
  mocks.get.mockResolvedValueOnce(childState)
  mocks.delivery.mockResolvedValueOnce({ ...run, id: 'child', harnessRunId: 'workspace:child' })
  mocks.assertSource.mockClear()
  expect(await projectNativeHarnessWait(childAccess, { status: 'running' })).toBe('projected')
  expect(mocks.assertSource).not.toHaveBeenCalled()
  expect(mocks.post).not.toHaveBeenCalled()
})

test('ordinary native waits without a surface source remain local to Overlay', async () => {
  mocks.surfaceExecution.mockResolvedValueOnce(null)
  expect(await projectNativeHarnessWait(access, { status: 'running' })).toBe('projected')
  expect(mocks.post).not.toHaveBeenCalled()
})
