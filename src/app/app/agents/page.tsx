import { Suspense } from 'react'
import { AgentConversationWorkspace } from '@/features/agents/components/AgentConversationWorkspace'
import { ConversationRouteSkeleton } from '@/features/chat/components/ChatSkeletons'

export default function AgentsPage() {
  return (
    <Suspense fallback={<ConversationRouteSkeleton />}>
      <AgentConversationWorkspace />
    </Suspense>
  )
}
