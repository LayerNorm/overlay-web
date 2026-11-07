import { Suspense } from 'react'

export const instant = false
import ChatSuspenseBoundary from '@/features/chat/components/ChatSuspenseBoundary'
import { getOverlaySession } from '@/server/auth/session'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'
async function ChatRouteContent() {
  const session = await getOverlaySession()
  const userId = session?.user.id ?? null
  const firstName = session?.user.firstName ?? undefined
  return (
    <ChatSuspenseBoundary
      userId={userId}
      firstName={firstName}
    />
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <ChatRouteContent />
    </Suspense>
  )
}
