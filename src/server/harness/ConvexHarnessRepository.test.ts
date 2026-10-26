import { beforeEach, expect, test, vi } from 'vitest'
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
