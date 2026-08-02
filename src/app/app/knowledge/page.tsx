import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { getOverlaySession } from '@/server/auth/session'
import { getInitialKnowledgeFiles, getInitialKnowledgeMemories } from '@/server/app/route-data'
import { redirect } from 'next/navigation'
import { KnowledgeRouteSkeleton } from '../_components/AppRouteSkeletons'

const KnowledgeView = dynamic(() => import('../_components/KnowledgeViewHost'), {
  loading: () => <KnowledgeRouteSkeleton />,
})

async function KnowledgeRouteContent({ userId }: { userId: string }) {
  const [initialFiles, initialMemories] = await Promise.all([
    getInitialKnowledgeFiles(),
    getInitialKnowledgeMemories(),
  ])

  return (
    <KnowledgeView
      userId={userId}
      initialFiles={initialFiles}
      initialMemories={initialMemories}
    />
  )
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getOverlaySession()

  if (!session) redirect('/app/chat?signin=nav')
  const params = await searchParams
  const rawView = params?.view
  const view = Array.isArray(rawView) ? rawView[0] : rawView
  const rawFile = params?.file
  const file = Array.isArray(rawFile) ? rawFile[0] : rawFile
  const rawMemory = params?.memory
  const memory = Array.isArray(rawMemory) ? rawMemory[0] : rawMemory
  if (file) redirect(`/app/files?file=${encodeURIComponent(file)}`)
  if (memory) redirect('/app/settings?section=memories')
  if (view === 'files') redirect('/app/files')
  if (view === 'outputs') redirect('/app/files?view=outputs')
  if (!view || view === 'memories') redirect('/app/settings?section=memories')
  return (
    <Suspense fallback={<KnowledgeRouteSkeleton />}>
      <KnowledgeRouteContent userId={session.user.id} />
    </Suspense>
  )
}
