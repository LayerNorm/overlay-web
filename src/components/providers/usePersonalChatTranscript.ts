'use client'

import { usePersonalChatRouteSelection } from './usePersonalChatRouteSelection'
import { usePersonalConversationTranscript } from './usePersonalConversationTranscript'

export {
  canSetPendingTranscript,
  pendingIntentMatches,
  pendingTranscriptInvalid,
  selectedChatIdFromRouteEvent,
} from './usePersonalChatRouteSelection'
export type { PendingTranscript } from './usePersonalChatRouteSelection'
export { isConvexIdShape } from './usePersonalConversationTranscript'

export function usePersonalChatTranscript({ workspaceId, canQuery, canRead, pathname, routeId }: {
  workspaceId: string | null
  canQuery: boolean
  canRead: boolean
  pathname: string
  routeId: string | null
}) {
  const {
    selectedConversationId, viewerUserId, conversationId, setPendingTranscriptConversation,
  } = usePersonalChatRouteSelection({ workspaceId, canQuery, canRead, pathname, routeId })
  const { selectedSummary, transcript } = usePersonalConversationTranscript({ workspaceId, conversationId, canQuery, canRead })

  return {
    selectedConversationId,
    selectedSummary,
    viewerUserId,
    setPendingTranscriptConversation,
    transcript,
  }
}
