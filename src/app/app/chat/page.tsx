import { Suspense } from 'react'

export const instant = false
import ChatSuspenseBoundary from '@/features/chat/components/ChatSuspenseBoundary'
import { getOverlaySession } from '@/server/auth/session'
import { getInitialChatHistory } from '@/server/app/route-data'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'
async function ChatRouteContent({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string | string[]; view?: string | string[] }>
}) {
  const session = await getOverlaySession()
  const params = await searchParams
  const userId = session?.user.id ?? null
  const firstName = session?.user.firstName ?? undefined
  const initialChatPage = userId
    ? await getInitialChatHistory(params?.scope !== undefined || params?.view !== undefined)
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
    />
  )
}

export default function ChatPage({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string | string[]; view?: string | string[] }>
}) {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <ChatRouteContent searchParams={searchParams} />
    </Suspense>
  )
}
