import { beforeEach, expect, test, vi } from 'vitest'
import { createNativeHarnessTools, type NativeHarnessToolsInput } from './native-tools'
import { executeNativeHarnessTool } from './native-tool-steps'
import type { HarnessToolExecutionOptions } from './tool-approvals'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), build: vi.fn(), execute: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('./native-access', () => ({ refreshNativeHarnessAccess: mocks.refresh }))
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

test('named-agent ask and post tools refuse without rebuilding authority or calling an executor', async () => {
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
    expect(await definition.execute!({}, options)).toEqual({
      success: false,
      error: 'Asking other agents is not available in this run yet.',
      code: 'harness_dispatch_required',
    })
  }
  expect(mocks.refresh).not.toHaveBeenCalled()
  expect(mocks.build).not.toHaveBeenCalled()
  expect(mocks.execute).not.toHaveBeenCalled()
})
