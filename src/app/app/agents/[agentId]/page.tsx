import { Suspense } from 'react'
import { AgentEditorPage } from '@/features/agents/components/AgentEditorPage'
import { AgentEditorRouteSkeleton } from '@/features/agents/components/EditorLoadGate'

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>
}) {
  const { agentId } = await params
  return (
    <Suspense fallback={<AgentEditorRouteSkeleton mode="edit" />}>
      <AgentEditorPage mode='edit' agentId={agentId} />
    </Suspense>
  )
}
