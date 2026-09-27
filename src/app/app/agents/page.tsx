import { Suspense } from 'react'
import { AgentConversationWorkspace } from '@/features/agents/components/AgentConversationWorkspace'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'

export default function AgentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <AgentsPageContent searchParams={searchParams} />
    </Suspense>
  )
}

async function AgentsPageContent({
  searchParams,
}: {
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  const params = await searchParams
  const showcase = Array.isArray(params?.showcase) ? params.showcase[0] === '1' : params?.showcase === '1'

  // Wrapped in <Suspense> by the page export above.
  // react-doctor-disable-next-line react-doctor/nextjs-no-use-search-params-without-suspense
  return <AgentConversationWorkspace showcase={showcase} />
}
