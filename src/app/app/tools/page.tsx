import { Suspense } from 'react'
import { ToolsRouteClient } from '../_components/ClientSessionRoutes'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'

export default function ToolsPage() {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <ToolsRouteClient />
    </Suspense>
  )
}
