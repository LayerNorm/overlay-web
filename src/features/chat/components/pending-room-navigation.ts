import type { ChatListConversation } from '@/shared/chat/chat-list-conversation'
import { selectConversationForView } from '@/shared/chat/chat-view-navigation'
import { captureNavigationIntent } from '@/shared/app/navigation-intent'

/** Resolve inside the destination, never steering a newer route or a different workspace. */
export function startPendingRoomNavigation(args: {
  href: string
  storedConversationId: string | null
  findRooms(): Promise<readonly ChatListConversation[] | null>
  currentHref(): string
  replace(href: string): void
  onError(): void
}): () => void {
  let cancelled = false
  const intentIsCurrent = captureNavigationIntent(args.href)
  const current = () => !cancelled && intentIsCurrent() && args.currentHref() === args.href
  void (async () => {
    let rooms: readonly ChatListConversation[]
    try {
      const result = await args.findRooms()
      if (result === null) throw new Error('Rooms unavailable')
      rooms = result
    } catch {
      if (!current()) return
      args.onError()
      rooms = []
    }
    if (!current()) return
    const destination = new URL(args.href, 'https://overlay.local')
    destination.searchParams.delete('select')
    const selected = selectConversationForView([...rooms], args.storedConversationId)
    if (selected) destination.searchParams.set('id', selected._id)
    args.replace(`${destination.pathname}${destination.search}${destination.hash}`)
  })()
  return () => { cancelled = true }
}
