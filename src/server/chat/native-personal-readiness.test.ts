import { beforeEach, expect, test, vi } from 'vitest'
const getAppSettings = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  appData: { repositories: { conversations: { getAppSettings } } },
}) }))
import { isNativePersonalChatBackendReady, nativePersonalChatBackendReady } from './native-personal-readiness'
beforeEach(() => { getAppSettings.mockReset() })
test.each([null, undefined, {}, { nativePersonalChatRevision: true }, { nativePersonalChatRevision: 'future' }])('keeps legacy ownership for unsupported readiness %j', value => {
  expect(isNativePersonalChatBackendReady(value)).toBe(false)
})
test('activates only from the existing backend endpoint for the authenticated subject', async () => {
  getAppSettings.mockResolvedValue({ nativePersonalChatRevision: 'native-personal-list-v1' })
  expect(await nativePersonalChatBackendReady('verified-user')).toBe(true)
  expect(getAppSettings).toHaveBeenCalledWith({ userId: 'verified-user' })
})
test('preserves legacy transport on old-backend or unavailable readiness', async () => {
  getAppSettings.mockResolvedValue({})
  expect(await nativePersonalChatBackendReady('verified-user')).toBe(false)
  getAppSettings.mockRejectedValue(new Error('backend unavailable'))
  expect(await nativePersonalChatBackendReady('verified-user')).toBe(false)
})
