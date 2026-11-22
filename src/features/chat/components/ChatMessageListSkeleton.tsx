/** One exchange shaped like ChatExchange: the right-aligned user bubble, then the assistant's lines. */
export function ChatMessageListSkeleton() {
  return (
    <div className="min-h-full space-y-2" aria-hidden>
      {/* `.ui-skeleton-line` sets its radius outside Tailwind's layers, so the bubble radius needs `!`. */}
      <div className="ui-skeleton-line ml-auto h-10 w-[min(60%,18rem)] rounded-[18px]!" />
      <div className="space-y-2.5 pt-2">
        <div className="ui-skeleton-line h-3 w-[min(72%,34rem)]" />
        <div className="ui-skeleton-line h-3 w-[min(88%,42rem)]" />
        <div className="ui-skeleton-line h-3 w-[min(54%,26rem)]" />
      </div>
    </div>
  )
}

/** Holds the transcript's frame while its code loads, matching ChatMessageList's layout. */
export function ChatMessageListPlaceholder() {
  return (
    <div className="overlay-chat-surface min-h-0 flex-1 overflow-hidden px-3 py-3 sm:px-4 sm:py-4" role="status" aria-label="Loading conversation">
      <div className="mx-auto w-full min-w-0 max-w-4xl">
        <ChatMessageListSkeleton />
      </div>
    </div>
  )
}
