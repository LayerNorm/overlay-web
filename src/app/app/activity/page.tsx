import { Suspense } from 'react'
import { ActivityRouteClient } from '../_components/ClientSessionRoutes'
import { ActivityRouteSkeleton } from '@/features/chat/components/ChatSkeletons'

export default function ActivityPage() {
  return (
    <Suspense fallback={<ActivityRouteSkeleton />}>
      <ActivityRouteClient />
    </Suspense>
  )
}
