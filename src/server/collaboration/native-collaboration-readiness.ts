import 'server-only'
import { cache } from 'react'
import { getOverlayServerContext } from '@/server/bootstrap'

export function isNativeCollaborationBackendReady(settings: unknown): boolean {
  return typeof settings === 'object' && settings !== null
    && 'nativeCollaborationRevision' in settings
    && settings.nativeCollaborationRevision === 'native-collaboration-v1'
}

export const nativeCollaborationBackendReady = cache(async (userId: string): Promise<boolean> => {
  try {
    const settings = await getOverlayServerContext().appData.repositories.conversations.getAppSettings({ userId })
    return isNativeCollaborationBackendReady(settings)
  } catch (_error) {
    return false
  }
})
