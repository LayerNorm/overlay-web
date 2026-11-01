import { beforeEach, expect, test, vi } from 'vitest'
import { FatalError, RetryableError } from 'workflow'
import { assertAutomationAdmissionSource, refreshAutomationHarnessSource } from './automation-access'
import type { PersonalHarnessAccess } from './personal-access'

const mocks = vi.hoisted(() => ({
  run: vi.fn(), automation: vi.fn(), workspace: vi.fn(), conversation: vi.fn(), agentRun: vi.fn(), agent: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/server/agents/agent-tooling', () => ({
  resolveAgentGrant: ({ allowedToolIds }: { allowedToolIds: string[] }) => ({
    overlayToolIds: allowedToolIds,
    capabilities: new Set(['integrations']),
  }),
}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  appData: { repositories: { automations: {
    getRunForExecution: mocks.run, getAutomation: mocks.automation,
  }, conversations: {
    getConversationById: mocks.conversation, getLatestAgentRun: mocks.agentRun,
  } } },
  workspaceService: { resolveActiveWorkspace: mocks.workspace },
  workspaceAgentService: { get: mocks.agent },
}) }))

const automation = {
  _id: 'automation', userId: 'user', workspaceId: 'workspace', enabled: false,
  conversationId: 'owned-conversation', sourceConversationId: 'provenance',
  agentId: 'agent',
}
const run = {
  _id: 'run', automationId: 'automation', userId: 'user', status: 'running',
  workflowRunId: 'workflow', scheduledFor: 1, conversationId: undefined, turnId: undefined,
}
const access: PersonalHarnessAccess = {
  actorUserId: 'user', workspaceId: 'workspace', principalId: 'principal', runId: 'personal:delivery',
  workflowRunId: 'workflow', conversationId: 'owned-conversation', agentRunId: 'delivery',
  authentication: { type: 'automation', automationId: 'automation', automationRunId: 'run', originWorkflowRunId: 'workflow' },
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.run.mockResolvedValue({ automation, run })
  mocks.workspace.mockResolvedValue({ workspace: { id: 'workspace' }, principal: { id: 'principal' } })
  mocks.conversation.mockResolvedValue({ userId: 'user', workspaceId: 'workspace', conversationType: 'personal' })
  mocks.agentRun.mockResolvedValue({ id: 'delivery', userId: 'user', conversationId: 'owned-conversation',
    turnId: 'automation-run:run', runner: 'workflow', executionEngine: 'overlay_harness' })
  mocks.agent.mockResolvedValue({ harness: 'overlay', allowedToolIds: ['read_file'], permissionMode: 'ask' })
})

test('manual queued runs require exact workflow acknowledgement and canonical run identity, even when disabled', async () => {
  mocks.run.mockResolvedValueOnce({ automation, run: { ...run, status: 'queued' } })
  const source = await assertAutomationAdmissionSource({
    automationId: 'automation', actorUserId: 'user', runId: 'run', originWorkflowRunId: 'workflow',
    workspaceId: 'workspace', conversationId: 'owned-conversation', turnId: 'untrusted',
  })
  expect(source).toMatchObject({
    workspaceId: 'workspace', conversationId: 'owned-conversation', turnId: 'automation-run:run',
    automationRunId: 'run',
  })
  mocks.run.mockResolvedValueOnce({ automation, run: { ...run, workflowRunId: undefined } })
  await expect(assertAutomationAdmissionSource({
    automationId: 'automation', actorUserId: 'user', runId: 'run', originWorkflowRunId: 'workflow',
  })).rejects.toBeInstanceOf(RetryableError)
  mocks.run.mockResolvedValueOnce({ automation, run: { ...run, status: 'cancelled' } })
  await expect(assertAutomationAdmissionSource({
    automationId: 'automation', actorUserId: 'user', runId: 'run', originWorkflowRunId: 'workflow',
  })).rejects.toBeInstanceOf(FatalError)
})

test('source and workspace mismatches fail before conversation side effects; source conversation is provenance only', async () => {
  await expect(assertAutomationAdmissionSource({
    automationId: 'automation', actorUserId: 'user', runId: 'run', originWorkflowRunId: 'workflow',
    workspaceId: 'other', conversationId: 'provenance',
  })).rejects.toBeInstanceOf(FatalError)
  expect(mocks.conversation).not.toHaveBeenCalled()
})

test('post-wait refresh rejects cancelled runs and intersects a revoked agent grant', async () => {
  const context = {
    accountAllowedToolIds: ['read_file', 'write_file'],
    accountAllowedConnectorIds: ['gmail'],
    integrationToolIds: ['gmail_send'],
    turnId: 'automation-run:run',
  } as never
  const refreshed = await refreshAutomationHarnessSource(access, context)
  expect(refreshed.allowedToolIds).toEqual(['read_file', 'gmail_send'])
  expect(refreshed.approvalMode).toBe('ask')
  mocks.run.mockResolvedValueOnce({ automation, run: { ...run, status: 'cancelled' } })
  await expect(refreshAutomationHarnessSource(access, context)).rejects.toBeInstanceOf(FatalError)
  mocks.agent.mockResolvedValueOnce({ harness: 'other', allowedToolIds: [] })
  await expect(refreshAutomationHarnessSource(access, context)).rejects.toBeInstanceOf(FatalError)
})

test('scheduler admission requires enabled state and exact scheduler owner', async () => {
  mocks.automation.mockResolvedValueOnce({ ...automation, enabled: false, schedulerWorkflowRunId: 'scheduler' })
  await expect(assertAutomationAdmissionSource({
    automationId: 'automation', actorUserId: 'user', originWorkflowRunId: 'scheduler', turnId: 'slot',
  })).rejects.toBeInstanceOf(FatalError)
  mocks.automation.mockResolvedValueOnce({ ...automation, enabled: true, schedulerWorkflowRunId: 'other' })
  await expect(assertAutomationAdmissionSource({
    automationId: 'automation', actorUserId: 'user', originWorkflowRunId: 'scheduler', turnId: 'slot',
  })).rejects.toBeInstanceOf(FatalError)
  mocks.automation.mockResolvedValueOnce({ ...automation, enabled: true, schedulerWorkflowRunId: 'scheduler' })
  const admitted = await assertAutomationAdmissionSource({
    automationId: 'automation', actorUserId: 'user', originWorkflowRunId: 'scheduler', turnId: 'slot',
  })
  expect(admitted).toMatchObject({ workspaceId: 'workspace', turnId: 'slot' })
  expect(admitted).not.toHaveProperty('automationRunId')
})
