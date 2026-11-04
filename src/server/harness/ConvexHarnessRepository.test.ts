import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/database/lazy-convex', () => ({ lazyConvex: mocks }))
vi.mock('@/server/shared/internal-api-secret', () => ({ getInternalApiSecret: () => 'fixture-secret' }))
const reference = { actorUserId: 'user', runId: 'root', workflowRunId: 'workflow', conversationId: 'conversation',
  agentRunId: 'delivery', authentication: { type: 'session' } }
const identity = { actorUserId: 'user', runId: 'root', workflowRunId: 'workflow', serverSecret: 'fixture-secret' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.query.mockResolvedValue([])
  mocks.mutation.mockResolvedValue({})
})
afterEach(() => vi.unstubAllGlobals())

test('journal uploads complete public data while storing only a bounded delivery snapshot', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ storageId: 'full-storage' })))
  vi.stubGlobal('fetch', fetch)
  mocks.mutation.mockResolvedValueOnce('https://storage.test/upload').mockResolvedValueOnce({ persisted: true }).mockResolvedValueOnce(null)
  const persistence = { content: 'A public update.', parts: Array.from({ length: 96 }, (_, index) => ({
    type: 'tool-invocation', toolInvocation: { toolCallId: `call-${index}`, toolName: 'get_note', toolOutput: { value: 'result '.repeat(2_000) } },
  })) }
  await new ConvexHarnessRepository().writeTranscriptStep({ ...identity, receiptId: 'model:0', stepNumber: 0, persistence })
  const upload = fetch.mock.calls[0][1]
  expect(JSON.parse(gunzipSync(Buffer.from(upload.body)).toString())).toEqual(persistence)
  const attach = mocks.mutation.mock.calls.find(call => call[0] === 'harness/runs:writeTranscriptStep')!
  expect(attach[1].persistence.parts.length).toBeLessThanOrEqual(81)
  expect(attach[1].fullPersistenceStorageId).toBe('full-storage')
  expect(attach[1].fullPersistenceDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(mocks.mutation).toHaveBeenLastCalledWith('harness/runs:discardTranscriptUpload', {
    ...identity, receiptId: 'model:0', storageId: 'full-storage',
  }, { throwOnError: true })
})

test('personal execution references never leak extra fields into strict Convex read validators', async () => {
  const repository = new ConvexHarnessRepository()
  await repository.get(reference)
  expect(mocks.query).toHaveBeenLastCalledWith('harness/runs:get', {
    actorUserId: 'user', runId: 'root', serverSecret: 'fixture-secret',
  }, { throwOnError: true })
  await repository.listPendingWaits(reference)
  expect(mocks.query).toHaveBeenLastCalledWith('harness/runs:listPendingWaits', identity, { throwOnError: true })
})

test('wait mutations serialize only the contract, not their caller authentication and delivery context', async () => {
  const repository = new ConvexHarnessRepository()
  const request = { kind: 'input' as const, token: 'token' }
  await repository.publishWait({ ...reference, request })
  expect(mocks.mutation).toHaveBeenLastCalledWith('harness/runs:publishWait', { ...identity, request }, { throwOnError: true })
  await repository.resolveWait({ ...reference, token: 'token' })
  expect(mocks.mutation).toHaveBeenLastCalledWith('harness/runs:resolveWait', { ...identity, token: 'token' }, { throwOnError: true })
})

test.each([
  { ...reference, executionGeneration: 0 },
  { ...reference, agentId: 'agent', workspaceId: 'workspace', executionGeneration: 1 },
])('durable wait replies serialize only the strict query contract: %j', async access => {
  const repository = new ConvexHarnessRepository()
  const reply = { text: 'Continue with the approved choice' }
  mocks.query.mockResolvedValueOnce(reply)
  await expect(repository.readWaitReply({ ...access, token: 'token' })).resolves.toEqual(reply)
  expect(mocks.query).toHaveBeenCalledExactlyOnceWith('harness/runs:readWaitReply', {
    ...identity, token: 'token',
  }, { throwOnError: true })
})

test('delivery cleanup query serializes only its authorized identity and cursor', async () => {
  const page = { workflowRunIds: ['workflow'], cursor: 'next', isDone: false, ignored: 'not returned' }
  mocks.query.mockResolvedValueOnce(page)
  const repository = new ConvexHarnessRepository()
  await expect(repository.listDeliveryWorkflowRuns({
    actorUserId: 'user', agentRunId: 'delivery', rootRunId: 'root', cursor: null,
  })).resolves.toEqual({ workflowRunIds: ['workflow'], cursor: 'next', isDone: false })
  expect(mocks.query).toHaveBeenLastCalledWith('harness/runs:listDeliveryWorkflowRuns', {
    actorUserId: 'user', agentRunId: 'delivery', rootRunId: 'root', cursor: null, serverSecret: 'fixture-secret',
  }, { throwOnError: true })
})

test('uploads and restores a gzip checkpoint through Convex File Storage', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const checkpoint = {
    version: 1 as const,
    messages: [{ role: 'assistant' as const, content: 'preserved output '.repeat(80_000) }],
    invocation: 3,
    modelCall: 9,
    stagnantSegments: 0,
    finalAnswerRequired: false,
    truncatedResponse: false,
    segmentStartedAt: 123,
  }
  const launchInput = {
    access: { actorUserId: 'user', workspaceId: 'workspace', runId: 'root', executionGeneration: 4 },
  }
  mocks.mutation
    .mockResolvedValueOnce({ uploadUrl: 'https://storage.example/upload' })
    .mockResolvedValueOnce({ runId: 'root', rootRunId: 'root', status: 'running', executionGeneration: 5, revision: 12, updatedAt: 123 })
  mocks.query
    .mockResolvedValueOnce({
      runId: 'root', rootRunId: 'root', status: 'running', revision: 12, executionGeneration: 5,
    })
    .mockResolvedValueOnce({
      workflowKind: 'personal',
      actorUserId: 'user',
      workspaceId: 'workspace',
      executionGeneration: 4,
      checkpointStorageUrl: 'https://storage.example/download',
    })
  const storedPayload = gzipSync(Buffer.from(JSON.stringify({ checkpoint, launchInput })))
  fetchMock
    .mockResolvedValueOnce({ ok: true, json: async () => ({ storageId: 'file-storage-id' }) })
    .mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => storedPayload.buffer.slice(
        storedPayload.byteOffset,
        storedPayload.byteOffset + storedPayload.byteLength,
      ),
    })

  const repository = new ConvexHarnessRepository()
  await repository.handoffContinuation({
    actorUserId: 'user',
    runId: 'root',
    workflowRunId: 'workflow',
    executionGeneration: 4,
    expectedRevision: 11,
    workflowKind: 'personal',
    checkpoint,
    launchInput,
  })
  const [uploadUrl, uploadRequest] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(uploadUrl).toBe('https://storage.example/upload')
  expect(uploadRequest.method).toBe('POST')
  expect(uploadRequest.headers).toEqual({ 'content-type': 'application/gzip' })
  const uploadedPayload = JSON.parse(gunzipSync(Buffer.from(uploadRequest.body as Uint8Array)).toString('utf8'))
  expect(uploadedPayload).toEqual({ checkpoint, launchInput })
  expect(mocks.mutation.mock.calls[1]?.[1]).toMatchObject({
    checkpointStorageId: 'file-storage-id',
    executionGeneration: 4,
    expectedRevision: 11,
    workflowKind: 'personal',
  })

  await expect(repository.getContinuationLaunch({
    runId: 'root',
    generation: 4,
    checkpointToken: 'root:4',
  })).resolves.toEqual({
    workflowKind: 'personal',
    checkpointJson: JSON.stringify(checkpoint),
    launchInputJson: JSON.stringify(launchInput),
  })
  expect(fetchMock.mock.calls[1]?.[0]).toBe('https://storage.example/download')
})

test('rejects checkpoint payloads whose persisted target identity does not match', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const compressed = gzipSync(Buffer.from(JSON.stringify({
    checkpoint: { version: 1, messages: [] },
    launchInput: { access: { actorUserId: 'other', workspaceId: 'workspace', runId: 'root', executionGeneration: 5 } },
  })))
  mocks.query.mockResolvedValueOnce({
    workflowKind: 'native',
    actorUserId: 'user',
    workspaceId: 'workspace',
    executionGeneration: 5,
    checkpointStorageUrl: 'https://storage.example/download',
  })
  fetchMock.mockResolvedValueOnce({
    ok: true,
    arrayBuffer: async () => compressed.buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength,
    ),
  })

  await expect(new ConvexHarnessRepository().getContinuationLaunch({
    runId: 'root',
    generation: 5,
    checkpointToken: 'root:5',
  })).rejects.toThrow('Harness continuation checkpoint identity is invalid.')
})
