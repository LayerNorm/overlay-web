import { beforeEach, expect, test, vi } from 'vitest'
import { createNativeHarnessTools, type NativeHarnessToolsInput } from './native-tools'
import { executeNativeHarnessTool } from './native-tool-steps'
import type { HarnessToolExecutionOptions } from './tool-approvals'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(), build: vi.fn(), execute: vi.fn(), dispatch: vi.fn(), progress: vi.fn(), apply: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/server/observability/logger', () => ({ logger: { warn: mocks.warn } }))
vi.mock('./native-access', () => ({ refreshNativeHarnessAccess: mocks.refresh }))
vi.mock('./state-steps', () => ({ applyHarnessOperation: mocks.apply }))
vi.mock('./native-tool-steps', async importOriginal => ({
  ...await importOriginal<typeof import('./native-tool-steps')>(),
  dispatchNativeHarnessAgentRequest: mocks.dispatch,
}))
vi.mock('./native-tool-progress', () => ({ projectNativeHarnessToolProgress: mocks.progress }))
vi.mock('@/server/agents/agent-tooling', () => ({ buildWorkspaceAgentTooling: mocks.build }))
vi.mock('@/server/conversations/personal-chat-work-tools', () => ({
  executePersonalChatWorkToolResult: async (options: {
    execute: () => Promise<unknown>; toModelOutput?: (args: unknown) => Promise<unknown>; input: unknown; toolCallId: string
  }) => {
    const output = await options.execute()
    return options.toModelOutput ? { overlayModelOutput: await options.toModelOutput({ input: options.input, toolCallId: options.toolCallId, output }), display: output } : output
  },
}))

const input: NativeHarnessToolsInput = {
  access: { actorUserId: 'human', runId: 'child', workflowRunId: 'workflow', workspaceId: 'workspace', principalId: 'human-principal',
    agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room', agentRunId: 'delivery',
    userMessageId: 'user-message', assistantMessageId: 'assistant-message', turnId: 'turn' },
  context: { modelId: 'model', memoryEnabled: true, sharedRoom: true, requestFingerprint: 'fingerprint' },
  definitions: [{ name: 'read_file', inputSchema: { type: 'object', properties: {} }, needsApproval: false }],
}
const options: HarnessToolExecutionOptions = { toolCallId: 'call', messages: [], context: undefined }
const authority = { agent: { id: 'agent', principalId: 'agent-principal', name: 'Research', allowedToolIds: ['files'], permissionMode: 'ask' },
  entitlements: { tools: true }, paid: true, latestUserText: 'Read the source' }
const tooling = (needsApproval = false) => ({ tools: { read_file: { execute: mocks.execute, needsApproval } }, toolsContext: { read_file: { fresh: true } } })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.refresh.mockResolvedValue(authority)
  mocks.build.mockImplementation(async () => tooling())
  mocks.execute.mockResolvedValue({ ok: true })
  mocks.progress.mockResolvedValue(undefined)
  mocks.apply.mockResolvedValue(undefined)
})

test('native tools reconstruct current identity, grants and memory policy with child-scoped effects', async () => {
  const definition = createNativeHarnessTools(input).read_file
  expect(await definition.needsApproval!({}, options)).toBe(false)
  expect(await definition.execute!({}, options)).toEqual({ ok: true })
  expect(mocks.refresh).toHaveBeenCalledTimes(3)
  expect(mocks.refresh).toHaveBeenLastCalledWith(input.access, input.context, 'read_file')
  expect(mocks.build).toHaveBeenLastCalledWith(expect.objectContaining({
    actorUserId: 'human', agentPrincipalId: 'agent-principal', conversationId: 'room', workspaceId: 'workspace',
    grant: { agentId: 'agent', allowedToolIds: ['files'], isDefaultMaster: false }, memoryEnabled: true,
    approvalMode: 'ask', computerApprovalContext: 'work', idempotencyKey: 'harness-run:child:tool:call',
  }))
  expect(mocks.execute).toHaveBeenLastCalledWith({}, expect.objectContaining({
    context: { fresh: true }, agentRunId: 'delivery', logicalStepId: 'call', idempotencyKey: 'harness-run:child:tool:call',
  }))
  await createNativeHarnessTools({ ...input, access: { ...input.access, runId: 'other-child' } }).read_file.execute!({}, options)
  expect(mocks.execute).toHaveBeenLastCalledWith({}, expect.objectContaining({ idempotencyKey: 'harness-run:other-child:tool:call' }))
})

test('a native tool step records evidence after a tool finishes during Stop', async () => {
  let runStatus = 'running'
  mocks.execute.mockImplementation(async () => {
    runStatus = 'cancelled'
    return { success: true, noteId: 'note-1' }
  })
  const evidence: unknown[] = []
  mocks.apply.mockImplementation(async (_reference: unknown, _operationId: string, operation: {
    type: string
    evidence?: unknown
  }) => {
    expect(runStatus).toBe('cancelled')
    if (operation.type === 'record_evidence') evidence.push(operation.evidence)
  })
  const result = await createNativeHarnessTools(input).read_file!.execute!({ fileId: 'file-1' }, options)
  expect(result).toEqual({ success: true, noteId: 'note-1' })
  expect(evidence).toHaveLength(1)
  expect(evidence[0]).toMatchObject({
    id: 'tool:call',
    kind: 'tool_result',
    source: 'read_file',
    verdict: 'observed',
    inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  })
  expect(mocks.apply).toHaveBeenCalledWith(input.access, 'tool-evidence:call', expect.objectContaining({
    type: 'record_evidence',
    evidence: expect.objectContaining({ id: 'tool:call', source: 'read_file' }),
  }))
})

test('a thrown native tool does not record result evidence', async () => {
  mocks.execute.mockRejectedValue(new Error('Tool failed.'))
  await expect(createNativeHarnessTools(input).read_file!.execute!({}, options)).rejects.toThrow('Tool failed.')
  expect(mocks.apply).not.toHaveBeenCalled()
})

test('revoked native authority or a removed grant prevents even an approved tool from executing', async () => {
  const definition = createNativeHarnessTools(input).read_file
  mocks.refresh.mockRejectedValueOnce(new Error('revoked'))
  await expect(definition.needsApproval!({}, options)).rejects.toThrow(/revoked/)
  expect(mocks.build).not.toHaveBeenCalled()
  mocks.build.mockResolvedValueOnce(tooling()).mockResolvedValueOnce({ tools: {} })
  await expect(definition.execute!({}, { ...options, harnessApproved: true } as HarnessToolExecutionOptions)).rejects.toThrow(/no longer authorized/)
  expect(mocks.execute).not.toHaveBeenCalled()
})

test('a new approval requirement refuses execution and model input cannot forge approval', async () => {
  const definition = createNativeHarnessTools(input).read_file
  mocks.build.mockResolvedValueOnce(tooling()).mockResolvedValueOnce(tooling(true))
  await expect(definition.execute!({ harnessApproved: true }, options)).rejects.toThrow(/became approval-required/)
  expect(mocks.execute).not.toHaveBeenCalled()
  mocks.build.mockImplementation(async () => tooling(true))
  await expect(definition.execute!({}, options)).rejects.toThrow(/requires fresh approval/)
  expect(await definition.execute!({}, { ...options, harnessApproved: true } as HarnessToolExecutionOptions)).toEqual({ ok: true })
  expect(mocks.execute).toHaveBeenCalledTimes(1)
})

test('MCP policy still requires approval when the individual tool flag is false', async () => {
  mocks.build.mockResolvedValue({ ...tooling(), toolApproval: () => 'user-approval' })
  const definition = createNativeHarnessTools(input).read_file
  expect(await definition.needsApproval!({}, options)).toBe(true)
  await expect(definition.execute!({}, options)).rejects.toThrow(/requires fresh approval/)
  expect(mocks.execute).not.toHaveBeenCalled()
})

test('native tools preserve model-output envelopes and never retry an ambiguous side effect', async () => {
  const modelOutput = { type: 'content', value: [{ type: 'text', text: 'mapped screenshot' }] }
  mocks.build.mockResolvedValue({ tools: { read_file: { execute: mocks.execute, toModelOutput: () => modelOutput } } })
  const definition = createNativeHarnessTools(input).read_file
  const result = await definition.execute!({}, options)
  expect(await definition.toModelOutput!({ toolCallId: 'call', input: {}, output: result })).toEqual(modelOutput)
  mocks.execute.mockRejectedValueOnce(new Error('ambiguous side effect'))
  await expect(definition.execute!({}, options)).rejects.toThrow(/ambiguous/)
  expect(mocks.execute).toHaveBeenCalledTimes(2)
  expect(executeNativeHarnessTool.maxRetries).toBe(0)
})

test('presentation progress failures do not change the tool result or re-execute it', async () => {
  mocks.progress.mockRejectedValue(new Error('progress write unavailable'))
  const definition = createNativeHarnessTools(input).read_file
  await expect(definition.execute!({ fileId: 'file' }, options)).resolves.toEqual({ ok: true })
  expect(mocks.execute).toHaveBeenCalledOnce()
  expect(mocks.progress).toHaveBeenCalledTimes(2)
  expect(mocks.warn).toHaveBeenCalledWith('[harness] native tool progress write failed', expect.objectContaining({
    runId: input.access.runId, toolCallId: 'call', error: 'progress write unavailable',
  }))
})

test('named-agent ask and post tools dispatch in process without rebuilding ordinary tool authority', async () => {
  mocks.dispatch.mockResolvedValue({ status: 'working', childRunIds: ['workspace:delivery'] })
  const tools = createNativeHarnessTools({
    ...input,
    definitions: ['ask_agent', 'post_message'].map(name => ({
      name,
      inputSchema: { type: 'object', properties: {} },
      needsApproval: false,
    })),
  })
  for (const name of ['ask_agent', 'post_message']) {
    const definition = tools[name]!
    expect(await definition.needsApproval!({}, options)).toBe(false)
    expect(await definition.execute!({ agent: 'Writer', message: 'Review this' }, options))
      .toEqual({ status: 'working', childRunIds: ['workspace:delivery'] })
  }
  expect(mocks.refresh).not.toHaveBeenCalled()
  expect(mocks.build).not.toHaveBeenCalled()
  expect(mocks.execute).not.toHaveBeenCalled()
  expect(mocks.dispatch).toHaveBeenCalledTimes(2)
  expect(mocks.dispatch).toHaveBeenNthCalledWith(1, input.access, input.context, 'call', 'ask_agent', { agent: 'Writer', message: 'Review this' })
  expect(mocks.dispatch).toHaveBeenNthCalledWith(2, input.access, input.context, 'call', 'post_message', { agent: 'Writer', message: 'Review this' })
})
