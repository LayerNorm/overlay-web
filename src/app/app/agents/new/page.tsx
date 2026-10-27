import { Suspense } from 'react'
import { AgentEditorPage } from '@/features/agents/components/AgentEditorPage'

export default function NewAgentPage() {
  return (
    <Suspense fallback={null}>
      <AgentEditorPage mode='new' />
    </Suspense>
  )
}
