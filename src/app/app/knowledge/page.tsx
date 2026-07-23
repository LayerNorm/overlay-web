import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { notFound, redirect } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { getOverlayCapabilities } from '@/server/capabilities'
import { getOverlayServerContext } from '@/server/bootstrap'
import { KnowledgeRouteSkeleton } from '../_components/AppRouteSkeletons'

const KnowledgeBaseListView = dynamic(
  () => import('@/features/knowledge-bases/components/KnowledgeBaseListView')
    .then((module) => module.KnowledgeBaseListView),
  { loading: () => <KnowledgeRouteSkeleton /> },
)

async function KnowledgeBaseListContent({ userId }: { userId: string }) {
  const knowledgeBases = await getOverlayServerContext().knowledgeBaseService.listKnowledgeBases(userId)
  return <KnowledgeBaseListView initialKnowledgeBases={knowledgeBases} userId={userId} />
}

export default async function KnowledgePage() {
  const capabilities = await getOverlayCapabilities()
  if (!capabilities.knowledge) notFound()

  const session = await getOverlaySession()
  if (!session) redirect('/app/chat?signin=nav')

  return (
    <Suspense fallback={<KnowledgeRouteSkeleton />}>
      <KnowledgeBaseListContent userId={session.user.id} />
    </Suspense>
  )
}
