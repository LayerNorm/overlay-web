import { Suspense } from 'react'
import { getOverlaySession } from '@/server/auth/session'
import dynamic from 'next/dynamic'
import { notFound, redirect } from 'next/navigation'
import { getInitialProjectList } from '@/server/app/route-data'
import { getOverlayCapabilities } from '@/server/capabilities'
import { ProjectsRouteSkeleton } from '../_components/AppRouteSkeletons'
import { PublicShowcaseProjectsView } from '@/features/showcase/PublicShowcaseProjectsView'

const ProjectsView = dynamic(() => import('@/features/projects/components/ProjectsView'), {
  loading: () => <ProjectsRouteSkeleton />,
})

async function ProjectsRouteContent({
  searchParams,
}: {
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  const session = await getOverlaySession()
  const params = await searchParams
  const showcaseParam = Array.isArray(params?.showcase) ? params.showcase[0] : params?.showcase

  if (showcaseParam === '1') return <PublicShowcaseProjectsView />
  if (!session) {
    redirect('/app/chat?signin=nav')
  }
  const initialProjects = await getInitialProjectList()
  return <ProjectsView userId={session.user.id} firstName={session.user.firstName ?? undefined} initialProjects={initialProjects} />
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  const capabilities = await getOverlayCapabilities()
  if (!capabilities.projects) {
    notFound()
  }

  return (
    <Suspense fallback={<ProjectsRouteSkeleton />}>
      <ProjectsRouteContent searchParams={searchParams} />
    </Suspense>
  )
}
