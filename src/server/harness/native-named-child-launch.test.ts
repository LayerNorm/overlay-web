import { expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), acquire: vi.fn(), delivery: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.get; acquireNativeTurn = mocks.acquire } }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({ appData: { repositories: { conversations: { getLatestAgentRun: mocks.delivery } } } }) }))

import { startNativeHarnessNamedChild } from './native-named-child-launch'

test('named-child launcher rejects a child identity mismatch before starting a workflow', async () => {
  const parent = {
    actorUserId: 'human', workspaceId: 'workspace', runId: 'workspace:parent',
    workflowRunId: 'parent-workflow', principalId: 'parent-principal', agentId: 'parent',
    agentPrincipalId: 'parent-principal', conversationId: 'parent-room', agentRunId: 'parent-run',
    userMessageId: 'parent-trigger', assistantMessageId: 'parent-reply', turnId: 'parent-turn',
  }
  const childRunId = 'workspace:target-run'
  mocks.get
    .mockResolvedValueOnce({
      runId: parent.runId, workflowRunId: parent.workflowRunId, rootRunId: parent.runId, depth: 0,
      status: 'running', policy: { actorUserId: 'human', workspaceId: 'workspace' },
      children: [{ id: childRunId, status: 'running' }],
    })
    .mockResolvedValueOnce({
      runId: 'workspace:other-run', parentRunId: parent.runId, rootRunId: parent.runId, depth: 1,
      status: 'running', policy: { actorUserId: 'human', workspaceId: 'workspace' },
    })
  await expect(startNativeHarnessNamedChild(parent, {
    access: { ...parent, runId: childRunId }, context: { modelId: 'model', memoryEnabled: false, sharedRoom: true, requestFingerprint: 'fp' },
    definitions: [], instructions: '', messages: [],
  }, childRunId)).rejects.toThrow(/Invalid native named-child launch authority/)
})

test('named-child launcher leaves a queued turn unlaunched instead of swapping the conversation owner', async () => {
  mocks.get.mockReset()
  const parent = { actorUserId: 'human', workspaceId: 'workspace', runId: 'workspace:parent', workflowRunId: 'parent-workflow',
    principalId: 'human-principal', agentId: 'parent', agentPrincipalId: 'parent-principal', conversationId: 'parent-room',
    agentRunId: 'parent', userMessageId: 'trigger', assistantMessageId: 'reply', turnId: 'turn' }
  const access = { ...parent, principalId: 'parent-principal', agentId: 'target', agentPrincipalId: 'target-principal',
    conversationId: 'assignment', agentRunId: 'target', userMessageId: 'question', assistantMessageId: 'answer', turnId: 'target-turn', runId: 'workspace:target' }
  mocks.get.mockResolvedValueOnce({ runId: parent.runId, rootRunId: parent.runId, workflowRunId: parent.workflowRunId,
    status: 'running', depth: 0, policy: { actorUserId: 'human', workspaceId: 'workspace' }, children: [{ id: access.runId, status: 'running' }] })
    .mockResolvedValueOnce({ runId: access.runId, parentRunId: parent.runId, rootRunId: parent.runId, depth: 1,
      status: 'running', policy: { actorUserId: 'human', workspaceId: 'workspace' } })
  mocks.delivery.mockResolvedValue({ id: 'target', userId: 'human', conversationId: 'assignment', turnId: 'target-turn',
    agentId: 'target', agentPrincipalId: 'target-principal', initiatorPrincipalId: 'parent-principal', userMessageId: 'question',
    assistantMessageId: 'answer', harnessRunId: access.runId, status: 'queued', mode: 'room', runner: 'workflow', executionEngine: 'overlay_harness' })
  mocks.acquire.mockResolvedValue(false)
  expect(await startNativeHarnessNamedChild(parent, { access, context: { modelId: 'model', memoryEnabled: false, sharedRoom: true,
    requestFingerprint: 'fp' }, definitions: [], instructions: '', messages: [] }, access.runId)).toBeNull()
  expect(mocks.acquire).toHaveBeenCalledWith({ actorUserId: 'human', deliveryAgentRunId: 'target' })
})
