import { Suspense } from 'react'
import { NotesRouteClient } from '../_components/ClientSessionRoutes'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'

export default function NotesPage() {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <NotesRouteClient />
    </Suspense>
  )
}
