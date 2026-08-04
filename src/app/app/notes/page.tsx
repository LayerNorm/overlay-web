import dynamic from 'next/dynamic'
import { getOverlaySession } from '@/server/auth/session'
import { redirect } from 'next/navigation'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const NotebookEditor = dynamic(() => import('@/features/notebook/components/NotebookEditor'), {
  loading: () => (
    <div className="h-full min-h-[40vh] w-full" aria-busy="true">
      <span className="sr-only">Loading notes</span>
    </div>
  ),
})

export default async function NotesPage() {
  const session = await getOverlaySession()

  if (!session) redirect('/app/chat?signin=nav')
  return <NotebookEditor userId={session.user.id} />
}
