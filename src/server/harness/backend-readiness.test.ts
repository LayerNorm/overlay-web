import { afterEach, expect, test, vi } from 'vitest'
import { isHarnessBackendReady } from './backend-readiness'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/database/lazy-convex', () => ({ lazyConvex: { query: mocks.query } }))
vi.mock('@/server/shared/internal-api-secret', () => ({ getInternalApiSecret: () => 'server-secret' }))
afterEach(() => vi.resetAllMocks())

test('new admission stays legacy until the backend publishes Harness support', async () => {
  mocks.query.mockResolvedValueOnce({ theme: 'light' })
    .mockResolvedValueOnce({ harnessRevision: 'overlay-harness-v1' })
  expect(await isHarnessBackendReady('user')).toBe(false)
  expect(await isHarnessBackendReady('user')).toBe(true)
  expect(mocks.query).toHaveBeenCalledWith('platform/uiSettings:getByServer', { userId: 'user', serverSecret: 'server-secret' }, { throwOnError: true })
})

test.each(['Unauthorized', 'fetch failed', 'Server Error', "Could not find public function for 'another/function:readiness'."])(
  'does not admit a legacy run after %s', async message => {
    mocks.query.mockRejectedValue(new Error(message))
    await expect(isHarnessBackendReady('user')).rejects.toThrow(message)
  },
)

test('rejects unsupported readiness', async () => {
  mocks.query.mockResolvedValue({ harnessRevision: 'future-revision' })
  await expect(isHarnessBackendReady('user')).rejects.toThrow('Unsupported Harness backend revision')
})

test('an empty query result cannot select another engine', async () => {
  mocks.query.mockResolvedValue(null)
  await expect(isHarnessBackendReady('user')).rejects.toThrow('readiness could not be determined')
})
