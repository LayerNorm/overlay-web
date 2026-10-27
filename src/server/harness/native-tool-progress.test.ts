import { beforeEach, expect, test, vi } from 'vitest'
import { projectNativeHarnessToolProgress, type NativeHarnessToolProgress } from './native-tool-progress'
import type { NativeHarnessAccess, NativeHarnessContext } from './native-access'

const mocks = vi.hoisted(() => ({ list: vi.fn(), append: vi.fn(), refresh: vi.fn(), warn: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./native-access', () => ({ refreshNativeHarnessAccess: mocks.refresh }))
vi.mock('@/server/observability/logger', () => ({ logger: { warn: mocks.warn } }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  appData: { repositories: { conversationCollaboration: { listMessages: mocks.list, appendAgentMessageDelta: mocks.append } } },
}) }))

const access: NativeHarnessAccess = {
  actorUserId: 'human', runId: 'workspace:delivery', workflowRunId: 'workflow',
  workspaceId: 'workspace', principalId: 'human-principal', agentId: 'agent',
  agentPrincipalId: 'agent-principal', conversationId: 'room', agentRunId: 'delivery',
  userMessageId: 'question', assistantMessageId: 'answer', turnId: 'turn',
}
const context: NativeHarnessContext = {
  modelId: 'fixture/model', memoryEnabled: false, sharedRoom: true, requestFingerprint: 'request',
}
const baseMessage = {
  _id: 'answer', turnId: 'turn', authorKind: 'agent', authorPrincipalId: 'agent-principal',
  status: 'generating', content: '', parts: [{ type: 'text', text: 'Working' }],
}
const progress: NativeHarnessToolProgress = {
  toolCallId: 'call', toolName: 'read_file', input: { fileId: 'file' }, state: 'input-available',
}

beforeEach(() => {
  vi.resetAllMocks()
  let message = { ...baseMessage, parts: baseMessage.parts.map(part => ({ ...part })) }
  mocks.refresh.mockResolvedValue({})
  mocks.list.mockImplementation(async () => [message])
  mocks.append.mockImplementation(async (args: { parts?: Array<Record<string, unknown>> }) => {
    message = { ...message, parts: (args.parts ?? []).map(part => ({ ...part })) }
  })
})

test('the delivery owner projects running then completed tool progress', async () => {
  await projectNativeHarnessToolProgress(access, context, progress)
  await projectNativeHarnessToolProgress(access, context, {
    ...progress, state: 'output-available', output: { ok: true },
  })

  expect(mocks.append).toHaveBeenCalledTimes(2)
  const running = mocks.append.mock.calls[0]![0].parts
  const completed = mocks.append.mock.calls[1]![0].parts
  expect(running).toEqual([
    { type: 'text', text: 'Working' },
    { type: 'tool-invocation', toolInvocation: {
      toolCallId: 'call', toolName: 'read_file', state: 'input-available', toolInput: { fileId: 'file' },
    } },
  ])
  expect(completed).toEqual([
    { type: 'text', text: 'Working' },
    { type: 'tool-invocation', toolInvocation: {
      toolCallId: 'call', toolName: 'read_file', state: 'output-available',
      toolInput: { fileId: 'file' }, toolOutput: { ok: true },
    } },
  ])
  expect(mocks.refresh).toHaveBeenCalledTimes(4)
})

test('anonymous children do not project tool progress', async () => {
  await projectNativeHarnessToolProgress({ ...access, runId: 'anonymous-child' }, context, progress)
  expect(mocks.refresh).not.toHaveBeenCalled()
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.append).not.toHaveBeenCalled()
})

test('stale or foreign message rows are skipped', async () => {
  for (const row of [
    undefined,
    { ...baseMessage, status: 'completed' },
    { ...baseMessage, turnId: 'other' },
    { ...baseMessage, authorPrincipalId: 'other-agent' },
    { ...baseMessage, _id: 'other-message' },
  ]) {
    mocks.list.mockResolvedValueOnce(row ? [row] : [])
    await projectNativeHarnessToolProgress(access, context, progress)
  }
  expect(mocks.append).not.toHaveBeenCalled()
})

test('persistence failures are presentation-only and bound', async () => {
  mocks.append.mockRejectedValue(new Error('write unavailable'))
  await expect(projectNativeHarnessToolProgress(access, context, {
    ...progress,
    state: 'output-error',
    output: { error: 'x'.repeat(20_000) },
  })).resolves.toBeUndefined()
  expect(mocks.warn).toHaveBeenCalled()
  expect(mocks.append).toHaveBeenCalledOnce()
  expect(JSON.stringify(mocks.append.mock.calls[0]![0].parts).length).toBeLessThan(10_000)
})
