import { beforeEach, expect, test, vi } from 'vitest'
import { deliverSurfaceWaitNoticeStep } from './surface-wait-steps'

const mocks = vi.hoisted(() => ({
  assertSource: vi.fn(),
  refreshSource: vi.fn(),
  postMessage: vi.fn(),
  getSlackAdapter: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('workflow', () => ({ FatalError: class FatalError extends Error {} }))
vi.mock('@/server/web/app-url', () => ({ getBaseUrl: () => 'https://overlay.example' }))
vi.mock('@/server/harness/surface-access', () => ({
  assertSurfaceAdmissionSource: mocks.assertSource,
  assertSurfaceConversation: vi.fn(),
  refreshSurfaceHarnessSource: mocks.refreshSource,
}))
vi.mock('@/server/surfaces/slack-reply', () => ({ postSlackAgentMessage: mocks.postMessage }))
vi.mock('@/server/surfaces/chat', () => ({ getSlackAdapter: mocks.getSlackAdapter }))

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
  creatorPrincipalId: 'principal',
  originWorkflowRunId: 'workflow',
}
const access = {
  actorUserId: 'user',
  runId: 'personal:delivery',
  workflowRunId: 'workflow',
  conversationId: 'conversation',
  agentRunId: 'delivery',
  workspaceId: 'workspace',
  principalId: 'principal',
  authentication: authority,
}
const context = {
  turnId: 'surface:slack:binding:message',
  accountAllowedToolIds: ['read_file'],
  accountAllowedConnectorIds: ['connector'],
  integrationToolIds: ['connector_tool'],
}
const source = { agent: { name: 'Current Agent' } }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.assertSource.mockResolvedValue(source)
  mocks.refreshSource.mockResolvedValue({})
  mocks.getSlackAdapter.mockResolvedValue({ id: 'slack-adapter' })
  mocks.postMessage.mockResolvedValue({ posted: true })
})

test.each([
  [{ wait: { kind: 'input', token: 'secret-wait-token', question: 'Raw private question' } }, 'needs input in Overlay'],
  [{ wait: { kind: 'approval', token: 'secret-approval-token', question: 'Raw private question', requests: [{ approvalId: 'secret-approval' }] } }, 'needs approval in Overlay'],
  [{ status: 'running' }, 'Working'],
] as const)('wait projection sends safe Slack notice without exposing wait payload', async (projection, expected) => {
  await deliverSurfaceWaitNoticeStep({ access, context, placeholderTs: 'placeholder', projection: projection as never })
  expect(mocks.refreshSource).toHaveBeenCalledWith(access, context, 'workflow')
  const message = mocks.postMessage.mock.calls[0]?.[0]
  expect(message.text).toContain(expected)
  if ('wait' in projection) {
    expect(message.text).toContain('a Slack reply will not resume the task')
    expect(message.text).toContain('/app/w/workspace/chat?')
  } else {
    expect(message.text).toBe('Working…')
  }
  expect(message.text).not.toContain('secret-wait-token')
  expect(message.text).not.toContain('secret-approval-token')
  expect(message.text).not.toContain('secret-approval')
  expect(message.text).not.toContain('Raw private question')
  expect(message).toMatchObject({
    teamId: 'team', channelId: 'channel', threadTs: 'thread', editTs: 'placeholder',
  })
})

test('revoked source prevents wait notice delivery', async () => {
  mocks.refreshSource.mockRejectedValueOnce(new Error('binding revoked'))
  await expect(deliverSurfaceWaitNoticeStep({
    access, context, placeholderTs: 'placeholder', projection: { status: 'running' },
  })).rejects.toThrow('binding revoked')
  expect(mocks.postMessage).not.toHaveBeenCalled()
})
