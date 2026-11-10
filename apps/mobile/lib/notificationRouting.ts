import { Alert } from 'react-native'
import type { Router } from 'expo-router'
import { api, convexWorkspaceId, queryConvex, type Id } from '../services/convexClient'
import type { WorkspaceNotification } from '@overlay/workspace-contracts'

/**
 * Routes a workspace notification to its native destination. Shared between
 * the Activity feed row tap and the foreground-banner tap handler so both
 * land on the same room/thread screen.
 */
export async function openNotificationDestination(
  router: Router,
  notification: Pick<
    WorkspaceNotification,
    'conversationState' | 'threadRootMessageId'
  > & { conversationId?: string },
): Promise<void> {
  if (!notification.conversationId) return
  if (notification.conversationState === 'archived') {
    router.push('/(tabs)/archived')
    return
  }
  if (notification.conversationState === 'deleted') return
  return openConversationDestination(router, notification.conversationId, notification.threadRootMessageId)
}

export async function openConversationDestination(router: Router, conversationId: string, threadRootMessageId?: string): Promise<void> {
  try {
    const args = { workspaceId: convexWorkspaceId(), conversationId: conversationId as Id<'conversations'> }
    const room = await queryConvex(api.collaboration.rooms.scope, args)
    if (!room && !await queryConvex(api.chat.personal.getSummary, args)) throw new Error('Conversation unavailable')
    const type = room?.conversationType ?? 'personal'
    // Thread notifications deep-link into the thread view when the root id is
    // present; message permalinks land on the room (scroll-to-message is a
    // documented gap in todos.md).
    if (threadRootMessageId && type !== 'personal') {
      router.push({
        pathname: '/thread/[id]',
        params: {
          id: threadRootMessageId,
          conversation: conversationId,
          type,
        },
      })
      return
    }
    if (type === 'channel') {
      router.push({ pathname: '/channel/[id]', params: { id: conversationId } })
    } else if (type === 'dm') {
      router.push({ pathname: '/dm/[id]', params: { id: conversationId } })
    } else {
      router.push({ pathname: '/chat/[id]', params: { id: conversationId } })
    }
  } catch {
    Alert.alert('Could not open the conversation', 'It may have been deleted.')
  }
}
