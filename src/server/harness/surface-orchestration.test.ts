import { beforeEach, expect, test, vi } from 'vitest'
import { surfaceAgentTurnWorkflow } from '@/server/workflows/surface-agent-turn'

const mocks = vi.hoisted(() => ({
  admitSource: vi.fn(),
  ensureConversation: vi.fn(),
  assertConversation: vi.fn(),
  prepare: vi.fn(),
  startAgentRun: vi.fn(),
  access: vi.fn(),
  admitHarness: vi.fn(),
  readDelivery: vi.fn(),
  refreshSource: vi.fn(),
  assertSource: vi.fn(),
  getConversation: vi.fn(),
  personalWorkflow: vi.fn(),
  postMessage: vi.fn(),
  getSlackAdapter: vi.fn(),
}))

vi.mock('workflow', () => ({
  FatalError: class FatalError extends Error {},
  getWorkflowMetadata: () => ({ workflowRunId: 'workflow' }),
}))
vi.mock('@/server/surfaces/surface-conversations', () => ({ ensureSurfaceConversation: mocks.ensureConversation }))
vi.mock('@/server/surfaces/slack-reply', () => ({ postSlackAgentMessage: mocks.postMessage }))
vi.mock('@/server/surfaces/chat', () => ({ getSlackAdapter: mocks.getSlackAdapter }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  appData: { repositories: { conversations: { getConversationById: mocks.getConversation } } },
}) }))
vi.mock('@/server/harness/surface-access', () => ({
  assertSurfaceAdmissionSource: mocks.assertSource,
  assertSurfaceConversation: mocks.assertConversation,
  refreshSurfaceHarnessSource: mocks.refreshSource,
}))
vi.mock('@/server/workflows/personal-harness', () => ({ personalHarnessWorkflow: mocks.personalWorkflow }))
vi.mock('@/server/workflows/surface-harness-steps', () => ({
  admitSurfaceHarnessStep: mocks.admitHarness,
  admitSurfaceSourceStep: mocks.admitSource,
  assertSurfaceConversationStep: mocks.assertConversation,
  prepareSurfaceTurnStep: mocks.prepare,
  readSurfaceDeliveryStep: mocks.readDelivery,
  startSurfaceAgentRunStep: mocks.startAgentRun,
  surfaceAccessForDelivery: mocks.access,
}))

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
const turnId = 'surface:slack:binding:message'
const input = {
  userId: 'untrusted-webhook-user',
  name: 'stale-name',
  instructions: 'hello from Slack',
  turnId: 'untrusted-turn',
  scheduledFor: 100,
  workspaceId: 'workspace',
  surface: {
    ...authority,
    authorName: 'Slack Author',
    authorExternalId: 'external-author',
    placeholderTs: 'placeholder-ts',
  },
}
const turnInput = {
  ...input,
  userId: 'creator-user',
  name: 'Current Agent',
  modelId: 'provider/model',
  turnId,
  surface: { ...input.surface, agentName: 'Current Agent' },
}
const toolingContext = {
  userId: 'creator-user',
  workspaceId: 'workspace',
  conversationId: 'conversation',
  turnId,
  billingProgrammaticSubjectId: 'surface:slack:binding',
  accountAllowedToolIds: ['read_file'],
  accountAllowedConnectorIds: ['connector'],
  integrationToolIds: ['connector_tool'],
  automationExecution: true,
  memoryOwnerId: 'agent-memory:agent',
}
const plan = {
  conversationId: 'conversation',
  effectiveModelId: 'provider/model',
  userMessageId: 'message-row',
  paid: true,
  instructions: 'Current agent instructions',
  messages: [{ role: 'user', content: 'hello from Slack' }],
  reservationId: null,
  toolDefinitions: [{ name: 'read_file' }],
  toolingContext,
}
const access = {
  actorUserId: 'creator-user',
  runId: 'personal:delivery',
  workflowRunId: 'workflow',
  conversationId: 'conversation',
  agentRunId: 'delivery',
  workspaceId: 'workspace',
  principalId: 'creator-principal',
  authentication: authority,
}
const source = { creatorPrincipalId: 'creator-principal', agent: { name: 'Current Agent' } }
const conversation = {
  userId: 'creator-user',
  workspaceId: 'workspace',
  createdByPrincipalId: 'creator-principal',
  conversationType: 'channel',
  externalPlatform: 'slack',
  externalChannelId: 'channel',
  externalThreadId: 'thread',
  surfaceBindingId: 'binding',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.admitSource.mockResolvedValue({ authority, turnInput })
  mocks.ensureConversation.mockResolvedValue({ conversationId: 'conversation', workspaceId: 'workspace' })
  mocks.assertConversation.mockResolvedValue(undefined)
  mocks.prepare.mockResolvedValue({ authority, turnInput, plan })
  mocks.startAgentRun.mockResolvedValue({ id: 'delivery', createdAt: 100 })
  mocks.access.mockReturnValue(access)
  mocks.admitHarness.mockResolvedValue({ runId: 'personal:delivery', status: 'queued' })
  mocks.readDelivery.mockResolvedValue('persisted assistant reply')
  mocks.assertSource.mockResolvedValue(source)
  mocks.refreshSource.mockResolvedValue({})
  mocks.getConversation.mockResolvedValue(conversation)
  mocks.getSlackAdapter.mockResolvedValue({ id: 'adapter' })
  mocks.postMessage.mockResolvedValue({ posted: true })
  mocks.personalWorkflow.mockResolvedValue({
    runId: 'personal:delivery',
    status: 'completed',
    replyText: 'assistant reply',
  })
})

test('fresh Slack turn enters the shared Harness with canonical surface billing and memory authority', async () => {
  const result = await surfaceAgentTurnWorkflow(input)
  expect(result).toMatchObject({ status: 'completed', deliveryStatus: 'posted' })
  expect(mocks.ensureConversation).toHaveBeenCalledWith(turnInput)
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
    turnId, workspaceId: 'workspace', conversationId: 'conversation',
  }), 'workflow')
  expect(mocks.personalWorkflow).toHaveBeenCalledWith(expect.objectContaining({
    access: expect.objectContaining({ authentication: authority }),
    context: expect.objectContaining({
      turnId,
      billingProgrammaticSubjectId: 'surface:slack:binding',
      memoryOwnerId: 'agent-memory:agent',
    }),
    delivery: {
      emitWebhook: false,
      closeStream: false,
      surface: { placeholderTs: 'placeholder-ts' },
    },
  }))
  expect(mocks.personalWorkflow.mock.calls[0]?.[0].context).not.toHaveProperty('automationId')
  expect(mocks.personalWorkflow.mock.calls[0]?.[0].context).not.toHaveProperty('automationRunId')
  expect(mocks.admitHarness).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: 'conversation',
    deliveryAgentRunId: 'delivery',
    allowedToolIds: ['read_file'],
  }))
  expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    editTs: 'placeholder-ts',
    text: 'assistant reply',
  }))
})

test('source revocation stops before conversation creation or provider preparation', async () => {
  mocks.admitSource.mockRejectedValueOnce(new Error('binding revoked'))
  await expect(surfaceAgentTurnWorkflow(input)).rejects.toThrow('binding revoked')
  expect(mocks.ensureConversation).not.toHaveBeenCalled()
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.startAgentRun).not.toHaveBeenCalled()
  expect(mocks.personalWorkflow).not.toHaveBeenCalled()
})

test('surface workflow rejects automation identity before any admission effects', async () => {
  await expect(surfaceAgentTurnWorkflow({ ...input, automationId: 'automation' })).rejects.toThrow(/automation identity/)
  await expect(surfaceAgentTurnWorkflow({ ...input, runId: 'run' })).rejects.toThrow(/automation identity/)
  expect(mocks.admitSource).not.toHaveBeenCalled()
  expect(mocks.ensureConversation).not.toHaveBeenCalled()
  expect(mocks.personalWorkflow).not.toHaveBeenCalled()
})

test('foreign AgentRun or Harness owners do not run or post a duplicate completion', async () => {
  mocks.startAgentRun.mockResolvedValueOnce({ id: 'delivery', createdAt: 100, workflowRunId: 'foreign' })
  await expect(surfaceAgentTurnWorkflow(input)).resolves.toMatchObject({
    status: 'already_running',
    deliveryStatus: 'not_attempted',
  })
  expect(mocks.admitHarness).not.toHaveBeenCalled()
  expect(mocks.personalWorkflow).not.toHaveBeenCalled()
  expect(mocks.postMessage).not.toHaveBeenCalled()

  mocks.startAgentRun.mockResolvedValueOnce({ id: 'delivery', createdAt: 100 })
  mocks.admitHarness.mockResolvedValueOnce({
    runId: 'personal:delivery',
    workflowRunId: 'foreign',
    status: 'running',
  })
  await expect(surfaceAgentTurnWorkflow(input)).resolves.toMatchObject({
    status: 'already_running',
    deliveryStatus: 'not_attempted',
  })
  expect(mocks.personalWorkflow).not.toHaveBeenCalled()
  expect(mocks.postMessage).not.toHaveBeenCalled()
})

test('same-owner terminal replay posts only persisted assistant content and never reinfers', async () => {
  mocks.startAgentRun.mockResolvedValueOnce({ id: 'delivery', createdAt: 100, workflowRunId: 'workflow' })
  mocks.admitHarness.mockResolvedValueOnce({
    runId: 'personal:delivery',
    workflowRunId: 'workflow',
    status: 'completed',
  })
  const result = await surfaceAgentTurnWorkflow(input)
  expect(result).toMatchObject({ status: 'completed', replyText: 'persisted assistant reply', deliveryStatus: 'posted' })
  expect(mocks.personalWorkflow).not.toHaveBeenCalled()
  expect(mocks.readDelivery).toHaveBeenCalledWith(expect.objectContaining({ turnId }))
  expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    editTs: 'placeholder-ts',
    text: 'persisted assistant reply',
  }))
})

test('same-owner failed replay stays failed and posts only a safe status notice', async () => {
  mocks.startAgentRun.mockResolvedValueOnce({ id: 'delivery', createdAt: 100, workflowRunId: 'workflow' })
  mocks.admitHarness.mockResolvedValueOnce({
    runId: 'personal:delivery',
    workflowRunId: 'workflow',
    status: 'failed',
    terminalReason: 'sensitive provider diagnostic',
  })
  const result = await surfaceAgentTurnWorkflow(input)
  expect(result).toMatchObject({ status: 'failed', deliveryStatus: 'posted' })
  expect(mocks.personalWorkflow).not.toHaveBeenCalled()
  expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    text: 'This task could not complete. Details are available in the Overlay conversation.',
  }))
  expect(mocks.postMessage.mock.calls[0]?.[0].text).not.toContain('sensitive provider diagnostic')
})

test('failed task status stays truthful when Slack delivery fails', async () => {
  mocks.personalWorkflow.mockResolvedValueOnce({
    runId: 'personal:delivery',
    status: 'failed',
    terminalReason: 'sensitive provider diagnostic',
  })
  mocks.postMessage.mockResolvedValueOnce({ posted: false })
  const result = await surfaceAgentTurnWorkflow(input)
  expect(result).toMatchObject({ status: 'failed', deliveryStatus: 'failed' })
  expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    text: 'This task could not complete. Details are available in the Overlay conversation.',
  }))
  expect(mocks.postMessage.mock.calls[0]?.[0].text).not.toContain('sensitive provider diagnostic')
})

test('Slack delivery failure does not change a successful Harness outcome', async () => {
  mocks.postMessage.mockResolvedValueOnce({ posted: false })
  const result = await surfaceAgentTurnWorkflow(input)
  expect(result).toMatchObject({ status: 'completed', deliveryStatus: 'failed' })
})

test('cancelled Harness outcome is never posted or returned as completed', async () => {
  mocks.personalWorkflow.mockResolvedValueOnce({
    runId: 'personal:delivery',
    status: 'cancelled',
    terminalReason: 'private cancellation details',
  })
  const result = await surfaceAgentTurnWorkflow(input)
  expect(result).toMatchObject({ status: 'cancelled', deliveryStatus: 'posted' })
  expect(mocks.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    text: 'This task was cancelled in Overlay.',
  }))
  expect(mocks.postMessage.mock.calls[0]?.[0].text).not.toContain('private cancellation details')
})

test('completed replay with no persisted assistant text does not invent a completion post', async () => {
  mocks.startAgentRun.mockResolvedValueOnce({ id: 'delivery', createdAt: 100, workflowRunId: 'workflow' })
  mocks.admitHarness.mockResolvedValueOnce({
    runId: 'personal:delivery',
    workflowRunId: 'workflow',
    status: 'completed',
  })
  mocks.readDelivery.mockResolvedValueOnce('')
  const result = await surfaceAgentTurnWorkflow(input)
  expect(result).toMatchObject({ status: 'completed', deliveryStatus: 'not_attempted' })
  expect(mocks.postMessage).not.toHaveBeenCalled()
  expect(mocks.personalWorkflow).not.toHaveBeenCalled()
})
