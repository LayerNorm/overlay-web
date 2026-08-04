import { Suspense } from 'react'
import ChatSuspenseBoundary from '@/features/chat/components/ChatSuspenseBoundary'
import { getOverlaySession } from '@/server/auth/session'
import { getInitialChatHistory } from '@/server/app/route-data'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'
import {
  SHOWCASE_CHAT_SNAPSHOTS,
  SHOWCASE_CHAT_SUMMARIES,
} from '@/features/showcase/showcase-data'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

async function ChatRouteContent({
  userId,
  firstName,
  publicShowcase,
}: {
  userId: string | null
  firstName?: string
  publicShowcase?: boolean
}) {
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

export default async function ChatPage({
  searchParams,
}: {
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  const session = await getOverlaySession()
  const params = await searchParams
  const showcaseParam = Array.isArray(params?.showcase) ? params.showcase[0] : params?.showcase
  const publicShowcase = showcaseParam === '1'

  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <ChatRouteContent
        userId={session?.user.id ?? null}
        firstName={session?.user.firstName ?? undefined}
        publicShowcase={publicShowcase}
      />
    </Suspense>
  )
}
