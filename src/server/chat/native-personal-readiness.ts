import 'server-only'
import { cache } from 'react'
import { getOverlayServerContext } from '@/server/bootstrap'

export function isNativePersonalChatBackendReady(settings: unknown): boolean {
  return typeof settings === 'object' && settings !== null
    && 'nativePersonalChatRevision' in settings
    && settings.nativePersonalChatRevision === 'native-personal-list-v1'
    && 'nativePersonalTranscriptRevision' in settings
    && settings.nativePersonalTranscriptRevision === 'native-personal-transcript-v1'
}

// Read an existing server endpoint, not a new native function that old backends lack.
// Request-local caching shares the probe between the shell and chat route only.
export const nativePersonalChatBackendReady = cache(async (userId: string): Promise<boolean> => {
  try {
    const settings = await getOverlayServerContext().appData.repositories.conversations.getAppSettings({ userId })
    return isNativePersonalChatBackendReady(settings)
  } catch (_error) {
    // Web-first upgrades and backend rollbacks retain the guarded legacy path.
    return false
  }
})
