import { Suspense } from 'react'
import { NotesRouteClient } from '../_components/ClientSessionRoutes'
import { NoteRouteSkeleton } from '../_components/PageRouteSkeletons'

export default function NotesPage() {
  return (
    <Suspense fallback={<NoteRouteSkeleton />}>
      <NotesRouteClient />
    </Suspense>
  )
}
