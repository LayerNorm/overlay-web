export function ChatMessageListSkeleton() {
  return (
    <div className="flex min-h-full flex-col justify-start pt-4 sm:pt-6">
      <div className="max-w-2xl space-y-4">
        <div className="tool-line-shimmer w-fit text-sm font-medium">Loading conversation</div>
        <div className="space-y-2.5">
          <div className="ui-skeleton-line h-3 w-[min(72%,34rem)]" />
          <div className="ui-skeleton-line h-3 w-[min(88%,42rem)]" />
          <div className="ui-skeleton-line h-3 w-[min(54%,26rem)]" />
        </div>
      </div>
    </div>
  )
}

/** Holds the transcript's frame while its code loads, matching ChatMessageList's layout. */
export function ChatMessageListPlaceholder() {
  return (
    <div className="overlay-chat-surface min-h-0 flex-1 overflow-hidden px-3 py-3 sm:px-4 sm:py-4" aria-busy="true">
      <div className="mx-auto w-full min-w-0 max-w-4xl">
        <ChatMessageListSkeleton />
      </div>
    </div>
  )
}
