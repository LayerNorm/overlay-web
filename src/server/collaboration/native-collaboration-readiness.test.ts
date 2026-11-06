import { beforeEach, expect, test, vi } from 'vitest'

const getAppSettings = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  appData: { repositories: { conversations: { getAppSettings } } },
}) }))
import { isNativeCollaborationBackendReady, nativeCollaborationBackendReady } from './native-collaboration-readiness'

beforeEach(() => getAppSettings.mockReset())
test.each([null, undefined, {}, { nativeCollaborationRevision: true }, { nativeCollaborationRevision: 'future' }])(
  'missing or unsupported readiness keeps legacy: %j', value => expect(isNativeCollaborationBackendReady(value)).toBe(false),
)
test('reads only the existing server endpoint for the verified user', async () => {
  getAppSettings.mockResolvedValue({ nativeCollaborationRevision: 'native-collaboration-v1' })
  expect(await nativeCollaborationBackendReady('alice')).toBe(true)
  expect(getAppSettings).toHaveBeenCalledWith({ userId: 'alice' })
})
test('old backends and failed probes fail closed, then recover', async () => {
  getAppSettings.mockResolvedValueOnce({})
  expect(await nativeCollaborationBackendReady('alice')).toBe(false)
  getAppSettings.mockRejectedValueOnce(new Error('backend unavailable'))
  expect(await nativeCollaborationBackendReady('alice')).toBe(false)
  getAppSettings.mockResolvedValueOnce({ nativeCollaborationRevision: 'native-collaboration-v1' })
  expect(await nativeCollaborationBackendReady('alice')).toBe(true)
})
