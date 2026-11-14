import { Suspense } from 'react'
import { ActivityRouteClient } from '../_components/ClientSessionRoutes'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'

export default function ActivityPage() {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <ActivityRouteClient />
    </Suspense>
  )
}
