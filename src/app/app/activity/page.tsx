import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { redirect } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const ChatActivityView = dynamic(
  () => import('@/features/chat/components/ChatActivityView')
    .then((module) => module.ChatActivityView),
  { loading: () => <ChatRouteSkeleton /> },
)

export default async function ActivityPage() {
  const session = await getOverlaySession()
  if (!session) redirect('/app/chat?signin=nav')

  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <ChatActivityView />
    </Suspense>
  )
}
