import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { redirect } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'

const ChatArchivedView = dynamic(
  () => import('@/features/chat/components/ChatArchivedView')
    .then((module) => module.ChatArchivedView),
  { loading: () => <ChatRouteSkeleton /> },
)

async function ArchivedRouteContent() {
  const session = await getOverlaySession()
  if (!session) redirect('/app/chat?signin=nav')
  return (
    <ChatArchivedView
      userId={session.user.id}
      firstName={session.user.firstName ?? undefined}
    />
  )
}

export default function ArchivedPage() {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <ArchivedRouteContent />
    </Suspense>
  )
}
