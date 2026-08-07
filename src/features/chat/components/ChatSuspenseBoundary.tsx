import { Suspense, type ReactNode } from 'react'
import ChatExperience from './ChatExperience'
import type { CachedConversation, ChatListPageInfo } from '@/shared/chat/chat-list-cache'
import type { ConversationLoadSnapshot } from './chat/chatTransport'

type ChatInterfaceProps = {
  userId: string | null
  firstName?: string
  hideSidebar?: boolean
  projectName?: string
  mode?: 'chat' | 'automate'
  hideHeader?: boolean
  belowEmptyComposer?: ReactNode
  initialChats?: CachedConversation[]
  initialChatPageInfo?: ChatListPageInfo
  publicShowcaseSnapshots?: Readonly<Record<string, ConversationLoadSnapshot>>
}

function ChatSuspenseFallback({ hideHeader = false, mode = 'chat' }: { hideHeader?: boolean; mode?: 'chat' | 'automate' }) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--background)]">
      {/* Header skeleton — keeps the chat chrome (header) visible while loading,
          matching AppScreenHeader's height and border so the layout doesn't
          jump once the real chat mounts. */}
      {hideHeader ? null : (
        <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4">
          <div className="ui-skeleton-line h-4 w-40 rounded-md" aria-hidden />
          <div className="flex items-center gap-2">
            {mode === 'automate' ? (
              <div className="ui-skeleton-line h-8 w-24 rounded-md" aria-hidden />
            ) : (
              <>
                <div className="ui-skeleton-line h-8 w-28 rounded-md" aria-hidden />
                <div className="ui-skeleton-line h-8 w-20 rounded-md" aria-hidden />
              </>
            )}
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1 items-start justify-center px-4 py-6">
        <div className="w-full max-w-4xl space-y-4" aria-hidden>
          <div className="tool-line-shimmer h-4 w-36 rounded" />
          <div className="space-y-2.5">
            <div className="ui-skeleton-line h-3 w-[min(72%,34rem)]" />
            <div className="ui-skeleton-line h-3 w-[min(88%,42rem)]" />
            <div className="ui-skeleton-line h-3 w-[min(54%,26rem)]" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ChatSuspenseBoundary(props: ChatInterfaceProps) {
  return (
    <Suspense fallback={<ChatSuspenseFallback hideHeader={props.hideHeader} mode={props.mode} />}>
      <ChatExperience {...props} />
    </Suspense>
  )
}
