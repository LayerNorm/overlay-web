import { expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DEFAULT_OVERLAY_CAPABILITIES } from '@overlay/app-core/capabilities'
import { CONVEX_APP_DATA_CAPABILITIES } from '@/server/app-data/capabilities'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { POST } from './route'

vi.mock('server-only', () => ({}))

const context: AppApiRouteContext = {
  params: Promise.resolve({}), auth: { userId: 'owner', accessToken: 'test', authType: 'session' },
  parsedQuery: {}, parsedJson: {}, parsedFormData: null, capabilities: DEFAULT_OVERLAY_CAPABILITIES,
  appDataCapabilities: CONVEX_APP_DATA_CAPABILITIES, requestFingerprint: 'test', requestIdempotencyKey: null,
  workspace: {
    workspace: { id: 'workspace', kind: 'personal', name: 'QA', slug: 'qa', status: 'active', createdAt: 1, updatedAt: 1 },
    principal: { id: 'owner', userId: 'owner', workspaceId: 'workspace', type: 'human', displayName: 'QA', createdAt: 1, updatedAt: 1 },
    membership: { workspaceId: 'workspace', principalId: 'owner', role: 'owner', status: 'active', joinedAt: 1, updatedAt: 1 },
  },
}

function request(extra: Record<string, unknown> = {}) {
  return new NextRequest('https://example.test/api/v1/conversations/stop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: 'conversation', harnessRunId: 'caller-supplied', ...extra }),
  })
}

function dependencies(result: Record<string, unknown>, callbacks: Array<() => Promise<void>>, cleanup = vi.fn()) {
  return {
    conversations: { cancelAgentRuns: vi.fn().mockResolvedValue(result) },
    abortToolLoops: vi.fn().mockReturnValue([]),
    recordMetrics: vi.fn().mockResolvedValue(undefined),
    cancelHarnessWorkflows: cleanup,
    schedule: vi.fn((callback: () => Promise<void>) => { callbacks.push(callback) }) as unknown as typeof import('next/server').after,
  }
}

test('stop schedules cleanup only for mutation-returned roots and keeps its response shape', async () => {
  const callbacks: Array<() => Promise<void>> = []
  const cleanup = vi.fn().mockResolvedValue(undefined)
  const deps = dependencies({
    cancelledRunIds: ['legacy-run'],
    cancelledWorkflowRunIds: [],
    cancelledWorkflows: [],
    cancelledHarnessRoots: [{ agentRunId: 'authoritative-delivery', runId: 'authoritative-root' }],
    stoppedCount: 1,
  }, callbacks, cleanup)

  const response = await POST(request(), context, deps)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    success: true, stoppedCount: 1, cancelledRunIds: ['legacy-run'],
    abortedLocalCount: 0, cancelledWorkflowCount: 0,
  })
  expect(callbacks).toHaveLength(1)
  await callbacks[0]!()
  expect(cleanup).toHaveBeenCalledExactlyOnceWith({
    actorUserId: 'owner', agentRunId: 'authoritative-delivery', rootRunId: 'authoritative-root',
  })
  expect(cleanup).not.toHaveBeenCalledWith(expect.objectContaining({ rootRunId: 'caller-supplied' }))
})

test('legacy stop results do not schedule a harness cleanup', async () => {
  const callbacks: Array<() => Promise<void>> = []
  const deps = dependencies({
    cancelledRunIds: [], cancelledWorkflowRunIds: [], cancelledWorkflows: [],
    stoppedCount: 0,
  }, callbacks)

  const response = await POST(request(), context, deps)
  expect(response.status).toBe(200)
  expect(callbacks).toHaveLength(0)
})

test('stop cancels workflows and schedules cleanup for returned named-child deliveries', async () => {
  const callbacks: Array<() => Promise<void>> = []
  const cleanup = vi.fn().mockResolvedValue(undefined)
  const cancelWorkflow = vi.fn().mockResolvedValue(undefined)
  const deps = {
    ...dependencies({
      cancelledRunIds: ['parent-agent-run', 'child-agent-run'],
      cancelledWorkflowRunIds: ['parent-workflow', 'child-workflow'],
      cancelledWorkflows: [
        { agentRunId: 'parent-agent-run', workflowRunId: 'parent-workflow' },
        { agentRunId: 'child-agent-run', workflowRunId: 'child-workflow' },
      ],
      cancelledHarnessRoots: [
        { agentRunId: 'parent-agent-run', runId: 'parent-root' },
        { agentRunId: 'child-agent-run', runId: 'named-child' },
      ],
      stoppedCount: 2,
    }, callbacks, cleanup),
    cancelWorkflow,
  }

  const response = await POST(request(), context, deps)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    success: true, stoppedCount: 2, cancelledRunIds: ['parent-agent-run', 'child-agent-run'],
    abortedLocalCount: 0, cancelledWorkflowCount: 2,
  })
  expect(cancelWorkflow).toHaveBeenCalledWith('child-workflow')
  expect(callbacks).toHaveLength(2)
  await Promise.all(callbacks.map(callback => callback()))
  expect(cleanup).toHaveBeenCalledWith({
    actorUserId: 'owner', agentRunId: 'child-agent-run', rootRunId: 'named-child',
  })
})
