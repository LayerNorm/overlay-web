import { Alert } from 'react-native'
import type { Router } from 'expo-router'
import { appJson } from '../services/appApi'
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
  try {
    const summary = await appJson<{ conversationType?: 'personal' | 'dm' | 'channel' }>(
      '/api/v1/conversations',
      { query: { conversationId: notification.conversationId } },
    )
    const type = summary.conversationType ?? 'personal'
    // Thread notifications deep-link into the thread view when the root id is
    // present; message permalinks land on the room (scroll-to-message is a
    // documented gap in todos.md).
    if (notification.threadRootMessageId && type !== 'personal') {
      router.push({
        pathname: '/thread/[id]',
        params: {
          id: notification.threadRootMessageId,
          conversation: notification.conversationId,
          type,
        },
      })
      return
    }
    if (type === 'channel') {
      router.push({ pathname: '/channel/[id]', params: { id: notification.conversationId } })
    } else if (type === 'dm') {
      router.push({ pathname: '/dm/[id]', params: { id: notification.conversationId } })
    } else {
      router.push({ pathname: '/chat/[id]', params: { id: notification.conversationId } })
    }
  } catch {
    Alert.alert('Could not open the conversation', 'It may have been deleted.')
  }
}
