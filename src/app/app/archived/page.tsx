import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { redirect } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { ARCHIVED_SETTINGS_PATH } from '@/shared/workspaces/panel-scope'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'

const ChatArchivedView = dynamic(
  () => import('@/features/chat/components/ChatArchivedView')
    .then((module) => module.ChatArchivedView),
  { loading: () => <ChatRouteSkeleton /> },
)

/**
 * Archived items live in Settings → Archived. This route only remains as the reader for one archived chat
 * (`?id=`, linked from Activity and from the Archived settings list); bare visits go to Settings.
 */
async function ArchivedRouteContent({ searchParams }: { searchParams?: Promise<{ id?: string | string[] }> }) {
  const session = await getOverlaySession()
  if (!session) redirect('/app/chat?signin=nav')
  const params = await searchParams
  if (!params?.id) redirect(ARCHIVED_SETTINGS_PATH)
  return (
    <ChatArchivedView
      userId={session.user.id}
      firstName={session.user.firstName ?? undefined}
    />
  )
}

export default function ArchivedPage({ searchParams }: { searchParams?: Promise<{ id?: string | string[] }> }) {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <ArchivedRouteContent searchParams={searchParams} />
    </Suspense>
  )
}
