import { beforeEach, expect, test, vi } from 'vitest'
import { createHarnessExecutionPorts } from './execution-ports'
import { serializeHarnessArtifactOutput } from './artifact-context'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  claim: vi.fn(), admit: vi.fn(), readMetadata: vi.fn(), readData: vi.fn(),
}))
vi.mock('./state-ports', () => ({ createHarnessStatePorts: () => ({ claim: mocks.claim }) }))
vi.mock('./request-usage-step', () => ({ admitHarnessRequestUsage: mocks.admit }))
vi.mock('./resource-boundary', () => ({ waitForHarnessModelResources: vi.fn() }))
vi.mock('./artifact-steps', () => ({
  readHarnessArtifactMetadata: mocks.readMetadata, readHarnessArtifactData: mocks.readData,
}))

const reference = { actorUserId: 'actor', runId: 'run', workflowRunId: 'workflow' }
const authorize = vi.fn()
const model = { prepareModel: vi.fn(), recordModelStep: vi.fn(), recoverModelFailure: vi.fn() }
const surface = {
  recordToolResult: vi.fn(), delegate: vi.fn(), readChild: vi.fn(), waitForChildren: vi.fn(),
  waitForInput: vi.fn(), waitForApproval: vi.fn(),
}
const create = () => createHarnessExecutionPorts({ reference, modelId: 'fixture/model', authorize, model, surface })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.claim.mockResolvedValue(true)
  mocks.readMetadata.mockReset()
  mocks.readData.mockReset()
  authorize.mockResolvedValue(undefined)
})

test('a surface authorizes the claimed execution before request accounting', async () => {
  const ports = create()
  expect(await ports.claim()).toBe(true)
  expect(authorize).toHaveBeenCalledExactlyOnceWith()
  expect(mocks.admit).toHaveBeenCalledExactlyOnceWith(reference, 'fixture/model')
  expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(authorize.mock.invocationCallOrder[0])
  expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(mocks.admit.mock.invocationCallOrder[0])
  expect(ports.prepareModel).toBe(model.prepareModel)
  expect(ports.waitForInput).toBe(surface.waitForInput)
  await ports.authorizeTool('read_file')
  expect(authorize).toHaveBeenLastCalledWith('read_file')
})

test('a losing workflow cannot authorize or consume a request allowance', async () => {
  mocks.claim.mockResolvedValue(false)
  expect(await create().claim()).toBe(false)
  expect(authorize).not.toHaveBeenCalled()
  expect(mocks.admit).not.toHaveBeenCalled()
})

test('revoked surface authorization fails closed before accounting or tools', async () => {
  authorize.mockRejectedValue(new Error('Access revoked'))
  const ports = create()
  await expect(ports.claim()).rejects.toThrow('Access revoked')
  expect(mocks.admit).not.toHaveBeenCalled()
  await expect(ports.authorizeTool('send_message')).rejects.toThrow('Access revoked')
})

test('artifact reads reauthorize the original tool before fetching private content', async () => {
  const bytes = serializeHarnessArtifactOutput({ text: 'The persisted document text.' })
  mocks.readMetadata.mockResolvedValue({
    artifactId: `ha_${'a'.repeat(64)}`, runId: 'run', workflowRunId: 'workflow',
    toolCallId: 'read-1', toolName: 'read_document', digest: 'b'.repeat(64),
    storageId: 'storage', byteSize: bytes.byteLength, mediaPartCount: 0, createdAt: 1, expiresAt: 2,
    resource: { id: 'file-1', revision: 'rev-7', page: 1 },
  })
  mocks.readData.mockResolvedValue(bytes)

  const ports = create()
  await expect(ports.readArtifact!({ artifactId: `ha_${'a'.repeat(64)}`, start: 0, end: 10 }))
    .resolves.toMatchObject({
      kind: 'text', text: 'The persis\n[Incomplete: more artifact text is available after character 10.]',
      metadata: {
        artifactId: `ha_${'a'.repeat(64)}`, toolName: 'read_document', toolCallId: 'read-1',
        mediaPartCount: 0, resource: { revision: 'rev-7' },
      },
    })
  expect(authorize).toHaveBeenCalledExactlyOnceWith('read_document')
  expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(mocks.readData.mock.invocationCallOrder[0]!)

  mocks.readData.mockClear()
  authorize.mockRejectedValueOnce(new Error('Permission revoked'))
  await expect(ports.readArtifact!({ artifactId: `ha_${'a'.repeat(64)}`, start: 0, end: 10 }))
    .rejects.toThrow('Permission revoked')
  expect(mocks.readData).not.toHaveBeenCalled()
})

test('tail text reads disclose omitted prefixes and preserve source identity', async () => {
  const bytes = serializeHarnessArtifactOutput({ text: 'A'.repeat(100) })
  mocks.readMetadata.mockResolvedValue({
    artifactId: `ha_${'a'.repeat(64)}`, runId: 'run', workflowRunId: 'workflow',
    toolCallId: 'read-2', toolName: 'read_document', digest: 'c'.repeat(64),
    storageId: 'storage', byteSize: bytes.byteLength, mediaPartCount: 0, createdAt: 1, expiresAt: 2,
    resource: { id: 'file-7', revision: 'rev-9', operation: 'read', page: 4 },
  })
  mocks.readData.mockResolvedValue(bytes)
  const result = await create().readArtifact!({ artifactId: `ha_${'a'.repeat(64)}`, start: 90, end: 100 })
  expect(result).toMatchObject({
    kind: 'text',
    text: `[Incomplete: characters before 90 were omitted.]\n${'A'.repeat(10)}`,
    metadata: {
      toolName: 'read_document', toolCallId: 'read-2',
      resource: { id: 'file-7', revision: 'rev-9', operation: 'read', page: 4 },
    },
  })
})
