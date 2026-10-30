import { buildWorkspaceHref } from '@/shared/workspaces/routing'

const isSavedConversation = (id: string) => Boolean(id) && !id.startsWith('__overlay_')

/** Capture the origin workspace and view before the user navigates elsewhere. */
export function captureReplyDestination(workspaceId: string, location: string, conversationId: string) {
  if (conversationId === '__overlay_temporary_chat__') return null
  const url = new URL(location, 'https://overlay.invalid')
  const view = url.searchParams.get('view') ?? (url.pathname.includes('/personal/') ? 'personal'
    : url.pathname.includes('/workspace/') ? 'workspace-chats' : null)
  const search = new URLSearchParams(view ? { view } : {})
  const base = buildWorkspaceHref(workspaceId, `/app/chat${search.size ? `?${search}` : ''}`)
  return { base, route: resolveReplyDestination(base, conversationId) }
}

export function resolveReplyDestination(base: string, conversationId: string): string | null {
  if (!isSavedConversation(conversationId)) return null
  const url = new URL(base, 'https://overlay.invalid')
  url.searchParams.set('id', conversationId)
  return `${url.pathname}${url.search}`
}
