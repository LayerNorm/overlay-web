import { beforeEach, expect, test, vi } from 'vitest'
import { workspaceAgentTurnWorkflow } from './workspace-agent-turn'

const mocks = vi.hoisted(() => ({
  attach: vi.fn(),
  fail: vi.fn(),
  loop: vi.fn(),
  prepare: vi.fn(),
  model: vi.fn(),
}))

vi.mock('workflow', () => ({
  FatalError: class FatalError extends Error {},
  getWorkflowMetadata: () => ({ workflowRunId: 'legacy-workflow' }),
}))
vi.mock('@/server/agents/workspace-agent-turn-lifecycle', () => ({
  attachWorkspaceAgentRun: mocks.attach,
  beginWorkspaceAgentModelCall: vi.fn(),
  callWorkspaceAgentModel: mocks.model,
  completeWorkspaceAgentRun: vi.fn(),
  executeWorkspaceAgentTool: vi.fn(),
  failWorkspaceAgentRun: mocks.fail,
  finalizeWorkspaceAgentTurn: vi.fn(),
  inspectWorkspaceAgentTool: vi.fn(),
  persistWorkspaceAgentToolProgress: vi.fn(),
  prepareWorkspaceAgentTurn: mocks.prepare,
  resumeWorkspaceAgentAfterApproval: vi.fn(),
  settleWorkspaceAgentUsage: vi.fn(),
  waitForWorkspaceAgentApproval: vi.fn(),
}))
vi.mock('@/server/agents/workspace-agent-turn-loop', () => ({ runWorkspaceAgentTurnLoop: mocks.loop }))
vi.mock('./workspace-agent-approval', () => ({ requestWorkspaceAgentApproval: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.prepare.mockRejectedValue(Object.assign(new Error('This room turn is owned by the native Harness workflow.'), {
    name: 'FatalError',
  }))
})

test('fails a native-owned row through the legacy workflow failure path before model execution', async () => {
  const input = {
    actorUserId: 'user', agentId: 'agent', conversationId: 'room', messageId: 'question',
    runId: 'agent-run', turnMessageId: 'answer', workspaceId: 'workspace',
  }
  await expect(workspaceAgentTurnWorkflow(input)).rejects.toThrow(/owned by the native Harness/)
  expect(mocks.attach).toHaveBeenCalledWith({
    actorUserId: 'user', runId: 'agent-run', workflowRunId: 'legacy-workflow',
  })
  expect(mocks.loop).not.toHaveBeenCalled()
  expect(mocks.model).not.toHaveBeenCalled()
  expect(mocks.fail).toHaveBeenCalledWith(expect.objectContaining({
    actorUserId: 'user', conversationId: 'room', runId: 'agent-run', turnMessageId: 'answer',
    errorMessage: 'This room turn is owned by the native Harness workflow.',
    retryable: false,
  }))
})
