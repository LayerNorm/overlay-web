import { AppRouteSessionRecovery } from '../_components/AppRouteSessionRecovery'
import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { getOverlaySession } from '@/server/auth/session'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'

const ToolsView = dynamic(() => import('@/features/tools/components/ToolsView'), {
  loading: () => <div className="flex min-h-[40vh] items-center justify-center text-sm text-[#888]">Loading...</div>,
})

async function ToolsRouteContent() {
  const session = await getOverlaySession()
  if (!session) return <AppRouteSessionRecovery />
  return <ToolsView userId={session.user.id} />
}

export default function ToolsPage() {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <ToolsRouteContent />
    </Suspense>
  )
}
