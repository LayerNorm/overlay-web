import { beforeEach, expect, test, vi } from 'vitest'
import { surfaceAgentTurnWorkflow } from '@/server/workflows/surface-agent-turn'

const mocks = vi.hoisted(() => ({
  admitSource: vi.fn(),
  ensureConversation: vi.fn(),
  assertConversation: vi.fn(),
  begin: vi.fn(),
  getExecution: vi.fn(),
  getState: vi.fn(),
  failOwned: vi.fn(),
  prepare: vi.fn(),
  assertSource: vi.fn(),
  getRun: vi.fn(),
  getMessages: vi.fn(),
  nativeWorkflow: vi.fn(),
  postMessage: vi.fn(),
  getSlackAdapter: vi.fn(),
  status: 'queued' as string,
  stateExists: false,
  content: 'persisted native reply',
  workflowOwner: 'workflow' as string | undefined,
}))

vi.mock('workflow', () => ({
  FatalError: class FatalError extends Error {},
  getWorkflowMetadata: () => ({ workflowRunId: 'workflow' }),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/server/surfaces/surface-conversations', () => ({ ensureSurfaceConversation: mocks.ensureConversation }))
vi.mock('@/server/surfaces/slack-reply', () => ({ postSlackAgentMessage: mocks.postMessage }))
vi.mock('@/server/surfaces/chat', () => ({ getSlackAdapter: mocks.getSlackAdapter }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  appData: { repositories: { conversations: {
    getLatestAgentRun: mocks.getRun,
    getConversationMessages: mocks.getMessages,
  } } },
}) }))
vi.mock('@/server/harness/ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class {
  beginSurfaceTurn = mocks.begin
  getSurfaceExecutionByHarnessRunId = mocks.getExecution
  get = mocks.getState
  failOwnedSurfaceTurn = mocks.failOwned
} }))
vi.mock('@/server/harness/surface-access', () => ({ assertPersistedSurfaceSource: mocks.assertSource }))
vi.mock('@/server/harness/native-turn-start', () => ({ prepareNativeHarnessTurn: mocks.prepare }))
vi.mock('@/server/workflows/native-harness', () => ({ nativeHarnessWorkflow: mocks.nativeWorkflow }))
vi.mock('@/server/workflows/surface-harness-steps', () => ({
  admitSurfaceSourceStep: mocks.admitSource,
  assertSurfaceConversationStep: mocks.assertConversation,
}))

const turnId = 'surface:slack:binding:message'
const input = {
  userId: 'webhook-user',
  name: 'stale webhook name',
  instructions: 'Summarize the release notes.',
  modelId: 'stale/model',
  turnId,
  scheduledFor: 100,
  workspaceId: 'workspace',
  surface: {
    platform: 'slack' as const,
    bindingId: 'binding',
    connectionId: 'connection',
    teamId: 'team',
    channelId: 'channel',
    threadId: 'thread',
    messageId: 'message',
    agentId: 'agent',
    agentPrincipalId: 'agent-principal',
    creatorPrincipalId: 'creator-principal',
    authorName: 'Slack Author',
    authorExternalId: 'external-author',
    placeholderTs: 'original-placeholder',
  },
}
const authority = {
  type: 'surface' as const,
  platform: 'slack' as const,
  bindingId: 'binding',
  connectionId: 'connection',
  teamId: 'team',
  channelId: 'channel',
  threadId: 'thread',
  messageId: 'message',
  agentId: 'agent',
  agentPrincipalId: 'agent-principal',
  creatorPrincipalId: 'creator-principal',
  originWorkflowRunId: 'workflow',
}
const turnInput = {
  ...input,
  userId: 'creator-user',
  name: 'Current Agent',
  modelId: 'provider/model',
  workspaceId: 'workspace',
  surface: { ...input.surface, agentName: 'Current Agent', agentInstructions: 'Current instructions' },
}
const execution = {
  turnId,
  workflowRunId: 'workflow',
  actorUserId: 'creator-user',
  workspaceId: 'workspace',
  creatorPrincipalId: 'creator-principal',
  agentId: 'agent',
  agentPrincipalId: 'agent-principal',
  platform: 'slack' as const,
  teamId: 'team',
  channelId: 'channel',
  threadId: 'thread',
  messageId: 'message',
  bindingId: 'binding',
  connectionId: 'connection',
  conversationId: 'room',
  agentRunId: 'delivery',
  userMessageId: 'question',
  assistantMessageId: 'assistant',
  harnessRunId: 'workspace:delivery',
  placeholderTs: 'original-placeholder',
  createdAt: 100,
  updatedAt: 100,
}
const conversation = { conversationId: 'room', workspaceId: 'workspace' }
const deliveryRun = () => ({
  id: 'delivery',
  userId: 'creator-user',
  conversationId: 'room',
  agentId: 'agent',
  agentPrincipalId: 'agent-principal',
  initiatorPrincipalId: 'creator-principal',
  turnId,
  userMessageId: 'question',
  assistantMessageId: 'assistant',
  harnessRunId: 'workspace:delivery',
  workflowRunId: mocks.workflowOwner,
  mode: 'room',
  runner: 'workflow',
  executionEngine: 'overlay_harness',
  status: mocks.status,
})
const state = () => ({
  runId: 'workspace:delivery',
  rootRunId: 'workspace:delivery',
  workflowRunId: 'workflow',
  policy: { actorUserId: 'creator-user', workspaceId: 'workspace' },
  status: mocks.status,
})
const workflowInput = {
  access: {
    actorUserId: 'creator-user',
    runId: 'workspace:delivery',
    workflowRunId: 'workflow',
    workspaceId: 'workspace',
    principalId: 'creator-principal',
    agentId: 'agent',
    agentPrincipalId: 'agent-principal',
    conversationId: 'room',
    agentRunId: 'delivery',
    userMessageId: 'question',
    assistantMessageId: 'assistant',
    turnId,
  },
  context: { modelId: 'provider/model', memoryEnabled: true, sharedRoom: false, requestFingerprint: 'fingerprint' },
  definitions: [{ name: 'read_file' }],
  instructions: 'Slack source context and agent instructions',
  messages: [{ role: 'user', content: 'Summarize the release notes.' }],
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.status = 'queued'
  mocks.stateExists = false
  mocks.content = 'persisted native reply'
  mocks.workflowOwner = 'workflow'
  mocks.admitSource.mockResolvedValue({ authority, turnInput })
  mocks.ensureConversation.mockResolvedValue(conversation)
  mocks.assertConversation.mockResolvedValue(undefined)
  mocks.begin.mockResolvedValue({ owner: 'same', execution })
  mocks.getExecution.mockResolvedValue(execution)
  mocks.getState.mockImplementation(async () => mocks.stateExists ? state() : null)
  mocks.failOwned.mockImplementation(async () => {
    mocks.status = 'failed'
    return { persisted: true }
  })
  mocks.prepare.mockImplementation(async () => {
    mocks.stateExists = true
    mocks.status = 'running'
    return { workflowInput, admitted: { status: 'running', workflowRunId: 'workflow' } }
  })
  mocks.assertSource.mockImplementation(async () => ({
    source: { agent: { name: 'Current Agent' } },
    run: deliveryRun(),
  }))
  mocks.getRun.mockImplementation(async () => deliveryRun())
  mocks.getMessages.mockImplementation(async () => [{ _id: 'assistant', content: mocks.content }])
  mocks.nativeWorkflow.mockImplementation(async () => {
    mocks.status = 'completed'
    mocks.stateExists = true
    return { runId: 'workspace:delivery', status: 'completed' }
  })
  mocks.getSlackAdapter.mockResolvedValue({ id: 'slack-adapter' })
  mocks.postMessage.mockResolvedValue({ posted: true })
})

test('surface turn directly invokes native workflow under the immutable root owner and delivers persisted result', async () => {
  const result = await surfaceAgentTurnWorkflow(input)
  expect(result).toEqual({ status: 'completed', deliveryStatus: 'posted' })
  expect(mocks.ensureConversation).toHaveBeenCalledWith(turnInput)
  expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({
    turnId, workflowRunId: 'workflow', actorUserId: 'creator-user', conversationId: 'room',
  }))
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
    actorUserId: 'creator-user',
    workspaceId: 'workspace',
    conversationId: 'room',
    runId: 'delivery',
    workflowRunId: 'workflow',
    expectedSurfaceWorkflowRunId: 'workflow',
  }))
  expect(mocks.nativeWorkflow).toHaveBeenCalledWith(workflowInput)
  expect(mocks.assertSource).toHaveBeenCalledWith(execution, 'workflow')
  expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    editTs: 'original-placeholder',
    text: 'persisted native reply',
    agentName: 'Current Agent',
  }))
})

test('foreign owner skips native preparation and Slack delivery', async () => {
  mocks.begin.mockResolvedValueOnce({ owner: 'foreign', execution })
  await expect(surfaceAgentTurnWorkflow(input)).resolves.toEqual({
    status: 'already_running', deliveryStatus: 'not_attempted',
  })
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.nativeWorkflow).not.toHaveBeenCalled()
  expect(mocks.postMessage).not.toHaveBeenCalled()
})

test('same-owner terminal replay delivers exact stored result without preparation or inference', async () => {
  mocks.status = 'completed'
  mocks.stateExists = true
  await expect(surfaceAgentTurnWorkflow(input)).resolves.toEqual({
    status: 'completed', deliveryStatus: 'posted',
  })
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.nativeWorkflow).not.toHaveBeenCalled()
  expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'persisted native reply' }))
})

test('preparation failure persists onto the owned delivery and sends only a safe notice', async () => {
  mocks.prepare.mockRejectedValueOnce(new Error('private provider credential details'))
  await expect(surfaceAgentTurnWorkflow(input)).rejects.toThrow('Native Harness preparation or admission failed.')
  expect(mocks.failOwned).toHaveBeenCalledWith({
    turnId, workflowRunId: 'workflow', agentRunId: 'delivery', assistantMessageId: 'assistant',
  })
  expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    text: 'This task failed in Overlay. Open the conversation for details.',
  }))
  expect(mocks.postMessage.mock.calls[0]?.[0].text).not.toContain('private provider')
  expect(mocks.nativeWorkflow).not.toHaveBeenCalled()
})

test('revoked source prevents terminal delivery without changing task outcome', async () => {
  mocks.assertSource.mockRejectedValueOnce(new Error('binding revoked'))
  const result = await surfaceAgentTurnWorkflow(input)
  expect(result).toEqual({ status: 'completed', deliveryStatus: 'not_attempted' })
  expect(mocks.nativeWorkflow).toHaveBeenCalledOnce()
  expect(mocks.postMessage).not.toHaveBeenCalled()
})

test('empty completed result and nonterminal task do not produce a Slack completion post', async () => {
  mocks.content = ''
  await expect(surfaceAgentTurnWorkflow(input)).resolves.toEqual({
    status: 'completed', deliveryStatus: 'not_attempted',
  })
  expect(mocks.postMessage).not.toHaveBeenCalled()

  mocks.status = 'queued'
  mocks.stateExists = false
  mocks.nativeWorkflow.mockImplementationOnce(async () => {
    mocks.status = 'running'
    mocks.stateExists = true
    return { runId: 'workspace:delivery', status: 'running' }
  })
  await expect(surfaceAgentTurnWorkflow(input)).resolves.toEqual({
    status: 'running', deliveryStatus: 'not_attempted',
  })
  expect(mocks.postMessage).not.toHaveBeenCalled()
})

test('failed/cancelled outcomes remain truthful and Slack failure does not replace task status', async () => {
  mocks.nativeWorkflow.mockImplementationOnce(async () => {
    mocks.status = 'failed'
    mocks.stateExists = true
    return { runId: 'workspace:delivery', status: 'failed' }
  })
  mocks.postMessage.mockResolvedValueOnce({ posted: false })
  await expect(surfaceAgentTurnWorkflow(input)).resolves.toEqual({
    status: 'failed', deliveryStatus: 'not_attempted',
  })
  expect(mocks.postMessage.mock.calls[0]?.[0].text).toBe('This task failed in Overlay. Open the conversation for details.')

  mocks.status = 'queued'
  mocks.stateExists = false
  mocks.nativeWorkflow.mockImplementationOnce(async () => {
    mocks.status = 'cancelled'
    mocks.stateExists = true
    return { runId: 'workspace:delivery', status: 'cancelled' }
  })
  mocks.postMessage.mockResolvedValueOnce({ posted: true })
  await expect(surfaceAgentTurnWorkflow(input)).resolves.toEqual({
    status: 'cancelled', deliveryStatus: 'posted',
  })
  expect(mocks.postMessage.mock.calls[1]?.[0].text).toBe('This task was cancelled in Overlay.')
})

test('automation identity is rejected before source admission or side effects', async () => {
  await expect(surfaceAgentTurnWorkflow({ ...input, automationId: 'automation' } as never))
    .rejects.toThrow(/automation identity/)
  await expect(surfaceAgentTurnWorkflow({ ...input, runId: 'run' } as never))
    .rejects.toThrow(/automation identity/)
  expect(mocks.admitSource).not.toHaveBeenCalled()
  expect(mocks.ensureConversation).not.toHaveBeenCalled()
  expect(mocks.begin).not.toHaveBeenCalled()
})
