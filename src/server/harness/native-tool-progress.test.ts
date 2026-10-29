import { beforeEach, expect, test, vi } from 'vitest'
import { projectNativeHarnessToolProgress, type NativeHarnessToolProgress } from './native-tool-progress'
import type { NativeHarnessAccess, NativeHarnessContext } from './native-access'

const mocks = vi.hoisted(() => ({ list: vi.fn(), append: vi.fn(), complete: vi.fn(), refresh: vi.fn(), warn: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./native-access', () => ({ refreshNativeHarnessAccess: mocks.refresh }))
vi.mock('@/server/observability/logger', () => ({ logger: { warn: mocks.warn } }))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  appData: { repositories: { conversationCollaboration: {
    listMessages: mocks.list,
    appendAgentMessageDelta: mocks.append,
    completeAgentToolInvocation: mocks.complete,
  } } },
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

test('a cancelled delivery can finalize only an existing running tool part', async () => {
  const runningPart = {
    type: 'tool-invocation',
    toolInvocation: {
      toolCallId: progress.toolCallId,
      toolName: progress.toolName,
      state: 'input-available',
      toolInput: progress.input,
    },
  }
  mocks.refresh.mockResolvedValue({ runStatus: 'cancelled' })
  mocks.list.mockResolvedValueOnce([{ ...baseMessage, parts: [...baseMessage.parts, runningPart] }])

  await projectNativeHarnessToolProgress(access, context, {
    ...progress, state: 'output-available', output: { ok: true },
  })

  expect(mocks.complete).toHaveBeenCalledWith({
    actorUserId: 'human',
    authorPrincipalId: 'agent-principal',
    conversationId: 'room',
    messageId: 'answer',
    turnId: 'turn',
    workspaceId: 'workspace',
    toolCallId: 'call',
    toolName: 'read_file',
    state: 'output-available',
    output: { ok: true },
  })
  expect(mocks.append).not.toHaveBeenCalled()
  expect(mocks.refresh).toHaveBeenCalledWith(access, context, 'read_file', { allowCancelledToolProgress: true })
})

test('a cancelled delivery finalizes a completed message with compacted output', async () => {
  const runningPart = {
    type: 'tool-invocation',
    toolInvocation: {
      toolCallId: progress.toolCallId,
      toolName: progress.toolName,
      state: 'input-available',
      toolInput: progress.input,
    },
  }
  const output = { payload: 'x'.repeat(20_000) }
  mocks.refresh.mockResolvedValue({ runStatus: 'cancelled' })
  mocks.list.mockResolvedValueOnce([{
    ...baseMessage,
    status: 'completed',
    parts: [...baseMessage.parts, runningPart],
  }])

  await projectNativeHarnessToolProgress(access, context, {
    ...progress, state: 'output-available', output,
  })

  expect(mocks.complete).toHaveBeenCalledOnce()
  const args = mocks.complete.mock.calls[0]![0] as { output?: unknown }
  expect(args).toMatchObject({
    actorUserId: 'human',
    authorPrincipalId: 'agent-principal',
    conversationId: 'room',
    messageId: 'answer',
    turnId: 'turn',
    workspaceId: 'workspace',
    toolCallId: 'call',
    toolName: 'read_file',
    state: 'output-available',
  })
  expect(args.output).not.toEqual(output)
  expect(args.output).toMatchObject({ truncated: true })
  expect(JSON.stringify(args.output).length).toBeLessThan(5_000)
  expect(mocks.append).not.toHaveBeenCalled()
})

test('a cancelled delivery can mark an existing tool part as errored', async () => {
  const runningPart = {
    type: 'tool-invocation',
    toolInvocation: {
      toolCallId: progress.toolCallId,
      toolName: progress.toolName,
      state: 'input-available',
      toolInput: progress.input,
    },
  }
  mocks.refresh.mockResolvedValue({ runStatus: 'cancelled' })
  mocks.list.mockResolvedValueOnce([{ ...baseMessage, parts: [...baseMessage.parts, runningPart] }])

  await projectNativeHarnessToolProgress(access, context, {
    ...progress, state: 'output-error', output: { error: 'failed' },
  })

  expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
    actorUserId: 'human',
    authorPrincipalId: 'agent-principal',
    conversationId: 'room',
    messageId: 'answer',
    turnId: 'turn',
    workspaceId: 'workspace',
    toolCallId: 'call',
    toolName: 'read_file',
    state: 'output-error',
    output: { error: 'failed' },
  }))
  expect(mocks.append).not.toHaveBeenCalled()
})

test('a cancelled run that ends after the first access read uses the final-state mutation', async () => {
  const runningPart = {
    type: 'tool-invocation',
    toolInvocation: {
      toolCallId: progress.toolCallId,
      toolName: progress.toolName,
      state: 'input-available',
      toolInput: progress.input,
    },
  }
  mocks.refresh
    .mockResolvedValueOnce({ runStatus: 'running' })
    .mockResolvedValueOnce({ runStatus: 'cancelled' })
  mocks.list.mockResolvedValueOnce([{
    ...baseMessage,
    status: 'completed',
    parts: [...baseMessage.parts, runningPart],
  }])

  await projectNativeHarnessToolProgress(access, context, {
    ...progress, state: 'output-available', output: { ok: true },
  })

  expect(mocks.complete).toHaveBeenCalledOnce()
  expect(mocks.append).not.toHaveBeenCalled()
})

test('cancelled deliveries cannot create tool parts or write non-final progress', async () => {
  mocks.refresh.mockResolvedValue({ runStatus: 'cancelled' })
  await projectNativeHarnessToolProgress(access, context, {
    ...progress, state: 'output-error', output: { error: 'failed' },
  })
  await projectNativeHarnessToolProgress(access, context, progress)

  expect(mocks.append).not.toHaveBeenCalled()
  expect(mocks.complete).not.toHaveBeenCalled()
})

test('anonymous children do not project tool progress', async () => {
  await projectNativeHarnessToolProgress({ ...access, runId: 'anonymous-child' }, context, progress)
  expect(mocks.refresh).not.toHaveBeenCalled()
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.append).not.toHaveBeenCalled()
  expect(mocks.complete).not.toHaveBeenCalled()
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
  expect(mocks.complete).not.toHaveBeenCalled()
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
