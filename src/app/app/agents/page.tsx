import { Suspense } from 'react'
import { AgentConversationWorkspace } from '@/features/agents/components/AgentConversationWorkspace'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'

export default function AgentsPage() {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <AgentConversationWorkspace />
    </Suspense>
  )
}
