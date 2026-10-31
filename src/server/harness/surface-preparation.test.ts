import { beforeEach, expect, test, vi } from 'vitest'
import { prepareNativeHarnessTurn } from './native-turn-start'

const mocks = vi.hoisted(() => ({
  assertSource: vi.fn(),
  buildInput: vi.fn(),
  getAgentRun: vi.fn(),
  getPaid: vi.fn(),
  admit: vi.fn(),
  getSurface: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  appData: { repositories: { conversations: {} } },
  chatUsagePolicy: {},
}) }))
vi.mock('./surface-access', () => ({ assertPersistedSurfaceSource: mocks.assertSource }))
vi.mock('./native-workflow-input-builder', () => ({ buildNativeHarnessWorkflowInput: mocks.buildInput }))
vi.mock('./ConvexHarnessRepository', () => ({
  ConvexHarnessRepository: class {
    admit = mocks.admit
    getSurfaceExecutionByHarnessRunId = mocks.getSurface
  },
}))
vi.mock('@/server/conversations/ActEntitlementService', () => ({
  ActEntitlementService: class { gateModelAccess = vi.fn(async () => ({ paid: false })) },
}))
vi.mock('./personal-admission-policy', () => ({ personalHarnessPolicy: vi.fn(input => input) }))
vi.mock('./write-tools', () => ({ harnessToolsRequirePlan: vi.fn(() => false) }))

const execution = {
  turnId: 'surface:slack:binding:message',
  workflowRunId: 'workflow',
  actorUserId: 'user',
  workspaceId: 'workspace',
  conversationId: 'room',
  bindingId: 'binding',
  agentRunId: 'delivery',
  userMessageId: 'question',
  assistantMessageId: 'answer',
  harnessRunId: 'workspace:delivery',
}
const workflowInput = {
  access: {
    actorUserId: 'user', runId: 'workspace:delivery', workspaceId: 'workspace', principalId: 'human',
    agentId: 'agent', agentPrincipalId: 'agent-principal', conversationId: 'room', agentRunId: 'delivery',
    userMessageId: 'question', assistantMessageId: 'answer', turnId: execution.turnId,
  },
  context: { modelId: 'provider/model', requestFingerprint: 'canonical-fingerprint' },
  definitions: [{ name: 'read_file' }],
  messages: [{ role: 'user', content: 'Use the attached brief.' }],
}
const agentRun = {
  id: 'delivery', userId: 'user', conversationId: 'room', agentId: 'agent', agentPrincipalId: 'agent-principal',
  turnId: execution.turnId, userMessageId: 'question', assistantMessageId: 'answer',
  mode: 'room', runner: 'workflow', executionEngine: 'overlay_harness', createdAt: 100,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getSurface.mockResolvedValue(execution)
  mocks.assertSource.mockResolvedValue({})
  mocks.buildInput.mockResolvedValue(workflowInput)
  mocks.getAgentRun.mockResolvedValue(agentRun)
  mocks.getPaid.mockResolvedValue(false)
  mocks.admit.mockResolvedValue({ runId: 'workspace:delivery', status: 'running' })
})

test('surface preparation validates immutable ownership before native input building and admission', async () => {
  const prepared = await prepareNativeHarnessTurn({
    actorUserId: 'user',
    workspaceId: 'workspace',
    conversationId: 'room',
    runId: 'delivery',
    memoryEnabled: true,
    expectedSurfaceWorkflowRunId: 'workflow',
  }, {
    getSurfaceExecution: mocks.getSurface,
    buildInput: mocks.buildInput,
    getAgentRun: mocks.getAgentRun,
    getPaid: mocks.getPaid,
    repository: { admit: mocks.admit } as never,
  })
  expect(mocks.assertSource).toHaveBeenCalledWith(execution, 'workflow')
  expect(mocks.buildInput).toHaveBeenCalledWith(expect.objectContaining({
    expectedSurfaceWorkflowRunId: 'workflow',
  }))
  expect(mocks.admit).toHaveBeenCalledWith(expect.objectContaining({
    runId: 'workspace:delivery',
    goal: 'Use the attached brief.',
    deliveryAgentRunId: 'delivery',
  }))
  expect(prepared?.admitted.status).toBe('running')
})

test('missing or foreign surface ownership fails before billable native preparation', async () => {
  mocks.getSurface.mockResolvedValue(null)
  await expect(prepareNativeHarnessTurn({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'room', runId: 'delivery',
    memoryEnabled: true, expectedSurfaceWorkflowRunId: 'workflow',
  }, {
    getSurfaceExecution: mocks.getSurface,
    buildInput: mocks.buildInput,
    getAgentRun: mocks.getAgentRun,
    getPaid: mocks.getPaid,
    repository: { admit: mocks.admit } as never,
  })).rejects.toThrow('unavailable')
  expect(mocks.buildInput).not.toHaveBeenCalled()
  expect(mocks.getPaid).not.toHaveBeenCalled()
  expect(mocks.admit).not.toHaveBeenCalled()
})

test('ordinary native starts cannot prepare a surface-owned queued room run', async () => {
  await expect(prepareNativeHarnessTurn({
    actorUserId: 'user', workspaceId: 'workspace', conversationId: 'room', runId: 'delivery', memoryEnabled: true,
  }, {
    getSurfaceExecution: mocks.getSurface,
    buildInput: mocks.buildInput,
    getAgentRun: mocks.getAgentRun,
    getPaid: mocks.getPaid,
    repository: { admit: mocks.admit } as never,
  })).rejects.toThrow('ownership')
  expect(mocks.buildInput).not.toHaveBeenCalled()
})
