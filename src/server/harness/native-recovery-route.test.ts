import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ start: vi.fn(), authorized: vi.fn(), launch: vi.fn(), native: vi.fn(), personal: vi.fn(), recovery: vi.fn() }))
vi.mock('workflow/api', () => ({ start: mocks.start }))
vi.mock('@/server/workflows/native-harness', () => ({ nativeHarnessWorkflow: mocks.native }))
vi.mock('@/server/workflows/personal-harness', () => ({ personalHarnessWorkflow: mocks.personal }))
vi.mock('@/server/workflows/native-recovery', () => ({ nativeRecoveryWorkflow: mocks.recovery }))
vi.mock('@/server/harness/ConvexHarnessRepository', () => ({ ConvexHarnessRepository: class { getContinuationLaunch = mocks.launch } }))
vi.mock('@/server/shared/internal-api-secret', () => ({ getInternalApiSecret: () => 'fixture', matchesInternalApiSecret: mocks.authorized }))

import { POST } from '@/app/api/v1/harness/continuation/route'

const request = (body: unknown) => new Request('https://preview.test/api/v1/harness/continuation', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => { vi.resetAllMocks(); mocks.authorized.mockReturnValue(true) })

test.each(['assignment', 'turn'] as const)('the authenticated callback dispatches only the persisted %s identity and generation', async kind => {
  expect((await POST(request({ kind, id: 'persisted-row', generation: 2, actorUserId: 'forged', workspaceId: 'forged' }))).status).toBe(202)
  expect(mocks.start).toHaveBeenCalledWith(mocks.recovery, [{ kind, id: 'persisted-row', generation: 2 }])
  expect(mocks.launch).not.toHaveBeenCalled()
})

test.each([null, {}, { kind: 'turn', id: 'row', generation: -1 }, { kind: 'assignment', id: 'row', generation: 0.5 }])('invalid callbacks do not start work: %j', async body => {
  expect((await POST(request(body))).status).toBe(400)
  expect(mocks.start).not.toHaveBeenCalled()
})

test('unauthenticated callers cannot discover or launch recovery work', async () => {
  mocks.authorized.mockReturnValue(false)
  expect((await POST(request({ kind: 'assignment', id: 'row', generation: 0 }))).status).toBe(401)
  expect(mocks.start).not.toHaveBeenCalled()
})

test('legacy continuation duplicates remain a successful no-op', async () => {
  mocks.launch.mockResolvedValue(null)
  const response = await POST(request({ runId: 'run', generation: 1, checkpointToken: 'run:1' }))
  expect(await response.json()).toEqual({ accepted: true, duplicate: true })
  expect(mocks.start).not.toHaveBeenCalled()
})
