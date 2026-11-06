import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { AgentEditorPage } from '@/features/agents/components/AgentEditorPage'

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>
}) {
  const { agentId } = await params
  let decodedAgentId: string
  try {
    decodedAgentId = decodeURIComponent(agentId)
  } catch {
    notFound()
  }
  if (!decodedAgentId) notFound()
  return (
    <Suspense fallback={null}>
      <AgentEditorPage mode='edit' agentId={decodedAgentId} />
    </Suspense>
  )
}
