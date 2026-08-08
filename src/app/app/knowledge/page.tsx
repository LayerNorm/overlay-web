import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { notFound, redirect } from 'next/navigation'
import { getOverlaySession } from '@/server/auth/session'
import { getOverlayCapabilities } from '@/server/capabilities'
import { getInitialKnowledgeBases } from '@/server/app/route-data'
import { KnowledgeRouteSkeleton } from '../_components/AppRouteSkeletons'
import { PublicShowcaseKnowledgeBasesView } from '@/features/showcase/PublicShowcaseKnowledgeBasesView'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const KnowledgeBaseListView = dynamic(
  () => import('@/features/knowledge-bases/components/KnowledgeBaseListView')
    .then((module) => module.KnowledgeBaseListView),
  { loading: () => <KnowledgeRouteSkeleton /> },
)

async function KnowledgeBaseListContent({ userId }: { userId: string }) {
  const knowledgeBases = await getInitialKnowledgeBases()
  return <KnowledgeBaseListView initialKnowledgeBases={knowledgeBases} userId={userId} />
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  const params = await searchParams
  const publicShowcase = Array.isArray(params?.showcase) ? params.showcase[0] === '1' : params?.showcase === '1'
  if (publicShowcase) return <PublicShowcaseKnowledgeBasesView />

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
