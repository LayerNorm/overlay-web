import { Suspense } from 'react'
import { AgentEditorPage } from '@/features/agents/components/AgentEditorPage'
import { AgentEditorRouteSkeleton } from '@/features/agents/components/EditorLoadGate'

export default function NewAgentPage() {
  return (
    <Suspense fallback={<AgentEditorRouteSkeleton mode="new" />}>
      <AgentEditorPage mode='new' />
    </Suspense>
  )
}
