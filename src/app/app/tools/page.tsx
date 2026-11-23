import { Suspense } from 'react'
import { ToolsRouteClient } from '../_components/ClientSessionRoutes'
import { ExtensionsRouteSkeleton } from '../_components/PageRouteSkeletons'

export default function ToolsPage() {
  return (
    <Suspense fallback={<ExtensionsRouteSkeleton />}>
      <ToolsRouteClient />
    </Suspense>
  )
}
