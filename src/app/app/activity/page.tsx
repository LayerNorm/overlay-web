import { AppRouteSessionRecovery } from '../_components/AppRouteSessionRecovery'
import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { getOverlaySession } from '@/server/auth/session'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'

const ChatActivityView = dynamic(
  () => import('@/features/chat/components/ChatActivityView')
    .then((module) => module.ChatActivityView),
  { loading: () => <ChatRouteSkeleton /> },
)

async function ActivityRouteContent() {
  const session = await getOverlaySession()
  if (!session) return <AppRouteSessionRecovery />
  return <ChatActivityView />
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <ActivityRouteContent />
    </Suspense>
  )
}
