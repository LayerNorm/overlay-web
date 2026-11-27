let sequence = 0

/**
 * Route to a fresh personal chat. The unique `newChatIntent` tells the chat
 * screen to drop whatever conversation it last showed and start a new draft,
 * even when the route is already mounted.
 */
export function newChatRoute() {
  return { pathname: '/chat', params: { newChatIntent: `${Date.now()}-${++sequence}` } } as const
}
