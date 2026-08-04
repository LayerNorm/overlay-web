import { Suspense } from 'react'
import { getOverlaySession } from '@/server/auth/session'
import dynamic from 'next/dynamic'
import { notFound, redirect } from 'next/navigation'
import { getInitialProjectList } from '@/server/app/route-data'
import { getOverlayCapabilities } from '@/server/capabilities'
import { ProjectsRouteSkeleton } from '../_components/AppRouteSkeletons'
import { PublicShowcaseProjectsView } from '@/features/showcase/PublicShowcaseProjectsView'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const ProjectsView = dynamic(() => import('@/features/projects/components/ProjectsView'), {
  loading: () => <ProjectsRouteSkeleton />,
})

async function ProjectsRouteContent({
  userId,
  firstName,
}: {
  userId: string
  firstName?: string
}) {
  const initialProjects = await getInitialProjectList()
  return <ProjectsView userId={userId} firstName={firstName} initialProjects={initialProjects} />
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

  const session = await getOverlaySession()
  const params = await searchParams
  const showcaseParam = Array.isArray(params?.showcase) ? params.showcase[0] : params?.showcase

  if (showcaseParam === '1') return <PublicShowcaseProjectsView />
  if (!session) {
    redirect('/app/chat?signin=nav')
  }
  return (
    <Suspense fallback={<ProjectsRouteSkeleton />}>
      <ProjectsRouteContent userId={session.user.id} firstName={session.user.firstName ?? undefined} />
    </Suspense>
  )
}
