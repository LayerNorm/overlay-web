import { beforeEach, expect, test, vi } from 'vitest'

const getAppSettings = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({ getOverlayServerContext: () => ({
  appData: { repositories: { conversations: { getAppSettings } } },
}) }))
import { isNativePersonalChatBackendReady, nativePersonalChatBackendReady } from './native-personal-readiness'

const ready = {
  nativePersonalChatRevision: 'native-personal-list-v1',
  nativePersonalTranscriptRevision: 'native-personal-transcript-v1',
  nativePersonalExecutionRevision: 'native-personal-execution-v1',
}

beforeEach(() => { getAppSettings.mockReset() })

test.each([
  null,
  undefined,
  {},
  { nativePersonalChatRevision: true },
  { nativePersonalChatRevision: 'future' },
  { nativePersonalChatRevision: ready.nativePersonalChatRevision },
  { ...ready, nativePersonalChatRevision: 'unknown' },
  { ...ready, nativePersonalTranscriptRevision: 'unknown' },
  { ...ready, nativePersonalExecutionRevision: 'unknown' },
  {
    nativePersonalChatRevision: ready.nativePersonalChatRevision,
    nativePersonalTranscriptRevision: ready.nativePersonalTranscriptRevision,
  },
])('keeps legacy ownership when readiness is unsupported or incomplete: %j', value => {
  expect(isNativePersonalChatBackendReady(value)).toBe(false)
})

test('activates only from the existing backend endpoint for the authenticated subject', async () => {
  getAppSettings.mockResolvedValue(ready)
  expect(await nativePersonalChatBackendReady('verified-user')).toBe(true)
  expect(getAppSettings).toHaveBeenCalledWith({ userId: 'verified-user' })
})

test('preserves legacy transport on old-backend or unavailable readiness', async () => {
  getAppSettings.mockResolvedValue({})
  expect(await nativePersonalChatBackendReady('verified-user')).toBe(false)
  getAppSettings.mockRejectedValue(new Error('backend unavailable'))
  expect(await nativePersonalChatBackendReady('verified-user')).toBe(false)
})

test('falls back without exposing a failed server probe and recovers when all markers are ready', async () => {
  getAppSettings.mockRejectedValueOnce(new Error('backend unavailable'))
  expect(await nativePersonalChatBackendReady('user')).toBe(false)
  expect(getAppSettings).toHaveBeenCalledWith({ userId: 'user' })
  getAppSettings.mockResolvedValueOnce(ready)
  expect(await nativePersonalChatBackendReady('user')).toBe(true)
})
