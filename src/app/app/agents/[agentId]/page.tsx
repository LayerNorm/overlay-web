import { Suspense } from 'react'
import { AgentEditorPage } from '@/features/agents/components/AgentEditorPage'

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>
}) {
  const { agentId } = await params
  return (
    <Suspense fallback={null}>
      <AgentEditorPage mode='edit' agentId={agentId} />
    </Suspense>
  )
}
