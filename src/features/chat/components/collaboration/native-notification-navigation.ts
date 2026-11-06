import type { NativeNotification } from '@/components/providers/native-activity-context'
import { buildWorkspaceHref, mergeHrefSearchParams } from '@/shared/workspaces/routing'

export function nativeNotificationHref(item: Pick<NativeNotification, 'workspaceId' | 'destination'>) {
  const destination = item.destination
  if (destination.archived) return mergeHrefSearchParams(buildWorkspaceHref(item.workspaceId, '/app/archived'), new URLSearchParams({ id: destination.conversationId }))
  const query = new URLSearchParams()
  if (destination.kind === 'agentThread' && destination.agentId) { query.set('id', destination.conversationId); query.set('agent', destination.agentId); query.set('scope', 'workspace') }
  else { query.set('view', destination.kind === 'channel' ? 'channels' : 'dms'); query.set('id', destination.conversationId) }
  if (destination.threadRootMessageId) query.set('thread', destination.threadRootMessageId)
  if (destination.messageId) query.set('message', destination.messageId)
  const path = destination.kind === 'agentThread' && destination.agentId ? '/app/agents' : '/app/chat'
  return mergeHrefSearchParams(buildWorkspaceHref(item.workspaceId, path), query)
}
