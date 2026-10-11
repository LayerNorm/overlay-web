import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { getOverlaySession } from '@/server/auth/session'
import { redirect } from 'next/navigation'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'

const WorkView = dynamic(() => import('@/features/work/components/WorkView').then((m) => m.WorkView), {
  loading: () => <div className="flex min-h-[40vh] items-center justify-center text-sm text-[#888]">Loading...</div>,
})

async function WorkRouteContent() {
  const session = await getOverlaySession()
  if (!session) {
    redirect('/app/chat?signin=nav')
  }
  return <WorkView />
}

export default function WorkPage() {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <WorkRouteContent />
    </Suspense>
  )
}
