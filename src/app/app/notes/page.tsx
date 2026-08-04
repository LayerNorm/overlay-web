import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { getOverlaySession } from '@/server/auth/session'
import { redirect } from 'next/navigation'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'

const NotebookEditor = dynamic(() => import('@/features/notebook/components/NotebookEditor'), {
  loading: () => (
    <div className="h-full min-h-[40vh] w-full" aria-busy="true">
      <span className="sr-only">Loading notes</span>
    </div>
  ),
})

async function NotesRouteContent() {
  const session = await getOverlaySession()
  if (!session) redirect('/app/chat?signin=nav')
  return <NotebookEditor userId={session.user.id} />
}

export default function NotesPage() {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <NotesRouteContent />
    </Suspense>
  )
}
