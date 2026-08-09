import { Suspense } from 'react'

export const instant = false
import ChatSuspenseBoundary from '@/features/chat/components/ChatSuspenseBoundary'
import { getOverlaySession } from '@/server/auth/session'
import { getInitialChatHistory } from '@/server/app/route-data'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'
import {
  SHOWCASE_CHAT_SNAPSHOTS,
  SHOWCASE_CHAT_SUMMARIES,
} from '@/features/showcase/showcase-data'

async function ChatRouteContent({
  searchParams,
}: {
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  const session = await getOverlaySession()
  const params = await searchParams
  const showcaseParam = Array.isArray(params?.showcase) ? params.showcase[0] : params?.showcase
  const publicShowcase = showcaseParam === '1'

  const userId = session?.user.id ?? null
  const firstName = session?.user.firstName ?? undefined

  const initialChatPage = publicShowcase
    ? { data: SHOWCASE_CHAT_SUMMARIES, nextCursor: undefined, hasMore: false }
    : userId
      ? await getInitialChatHistory()
      : null
  return (
    <ChatSuspenseBoundary
      userId={userId}
      firstName={firstName}
      initialChats={initialChatPage?.data}
      initialChatPageInfo={initialChatPage ? {
        nextCursor: initialChatPage.nextCursor,
        hasMore: initialChatPage.hasMore,
      } : undefined}
      publicShowcaseSnapshots={publicShowcase ? SHOWCASE_CHAT_SNAPSHOTS : undefined}
    />
  )
}

export default function ChatPage({
  searchParams,
}: {
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <ChatRouteContent searchParams={searchParams} />
    </Suspense>
  )
}
