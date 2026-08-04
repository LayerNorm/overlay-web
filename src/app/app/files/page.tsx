import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { getOverlaySession } from '@/server/auth/session'
import { getInitialKnowledgeFiles } from '@/server/app/route-data'
import { redirect } from 'next/navigation'
import { resolveKnowledgeLayout } from '@overlay/app-core'
import { FilesRouteSkeleton, type FilesRouteSkeletonLayout } from '../_components/AppRouteSkeletons'
import { FilesRouteLoadingSkeleton } from './FilesRouteLoadingSkeleton'
import { PublicShowcaseKnowledgeView } from '@/features/showcase/PublicShowcaseKnowledgeView'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const KnowledgeView = dynamic(() => import('../_components/KnowledgeViewHost'), {
  loading: () => <FilesRouteLoadingSkeleton />,
})

type FilesSearchParams = {
  layout?: string | string[]
  showcase?: string | string[]
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function resolveFilesLayout(params?: FilesSearchParams): FilesRouteSkeletonLayout {
  return resolveKnowledgeLayout({
    layout: firstParam(params?.layout),
    activeTab: 'files',
  })
}

async function FilesRouteContent({ userId }: { userId: string }) {
  const initialFiles = await getInitialKnowledgeFiles()

  return (
    <KnowledgeView
      userId={userId}
      mode="files"
      initialFiles={initialFiles}
    />
  )
}

export default async function FilesPage({
  searchParams,
}: {
  searchParams?: Promise<FilesSearchParams>
}) {
  const session = await getOverlaySession()
  const params = await searchParams
  const publicShowcase = firstParam(params?.showcase) === '1'

  if (publicShowcase) return <PublicShowcaseKnowledgeView />
  if (!session) redirect('/app/chat?signin=nav')
  const layout = resolveFilesLayout(params)
  return (
    <Suspense fallback={<FilesRouteSkeleton layout={layout} />}>
      <FilesRouteContent userId={session.user.id} />
    </Suspense>
  )
}
