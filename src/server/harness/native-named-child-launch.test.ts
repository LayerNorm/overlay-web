import { expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { get = mocks.get } }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: vi.fn() }))

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
