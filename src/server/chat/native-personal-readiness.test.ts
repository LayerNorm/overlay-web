import { describe, expect, it, vi } from 'vitest'

const { getAppSettings } = vi.hoisted(() => ({ getAppSettings: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/server/bootstrap', () => ({
  getOverlayServerContext: () => ({ appData: { repositories: { conversations: { getAppSettings } } } }),
}))
import { isNativePersonalChatBackendReady, nativePersonalChatBackendReady } from './native-personal-readiness'

const ready = { nativePersonalChatRevision: 'native-personal-list-v1', nativePersonalTranscriptRevision: 'native-personal-transcript-v1' }

describe('native personal transcript readiness', () => {
  it('requires both compatible list and transcript support, not just native authentication', () => {
    expect(isNativePersonalChatBackendReady(ready)).toBe(true)
    for (const settings of [null, {}, { nativePersonalChatRevision: ready.nativePersonalChatRevision },
      { ...ready, nativePersonalTranscriptRevision: 'unknown' }, { ...ready, nativePersonalChatRevision: 'unknown' }]) {
      expect(isNativePersonalChatBackendReady(settings)).toBe(false)
    }
  })
  it('falls back without exposing a failed server probe', async () => {
    getAppSettings.mockRejectedValueOnce(new Error('backend unavailable'))
    expect(await nativePersonalChatBackendReady('user')).toBe(false)
    expect(getAppSettings).toHaveBeenCalledWith({ userId: 'user' })
    getAppSettings.mockResolvedValueOnce(ready)
    expect(await nativePersonalChatBackendReady('user')).toBe(true)
  })
})
