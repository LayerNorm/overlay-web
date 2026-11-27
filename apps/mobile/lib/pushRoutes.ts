export function parsePushUrl(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  )
    return null
  try {
    const url = new URL(value, 'https://overlay.invalid')
    const match = /^\/(channel|dm|chat|thread)\/([A-Za-z0-9_-]+)$/.exec(url.pathname)
    const workspaceId = url.searchParams.get('workspaceId')
    if (!match || !workspaceId || url.hash) return null
    const conversationId = match[1] === 'thread' ? url.searchParams.get('conversation') : match[2]
    if (!conversationId || !/^[A-Za-z0-9_-]+$/.test(conversationId)) return null
    return {
      kind: match[1],
      conversationId,
      threadRootMessageId: match[1] === 'thread' ? match[2] : undefined,
      workspaceId,
      notificationType: url.searchParams.get('notificationType'),
    }
  } catch {
    return null
  }
}
