import { conversationDetailRouteKey } from '../conversationScopeVerification'
import type { NativeCollaborationStatus } from './NativeCollaborationProvider'

export function nativeRoomRouteKey(status: NativeCollaborationStatus, view: string | null, args: Parameters<typeof conversationDetailRouteKey>[0]) {
  return status !== 'disabled' && (view === 'dms' || view === 'channels') ? null : conversationDetailRouteKey(args)
}
