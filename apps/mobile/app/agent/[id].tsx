import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { AgentEditorScreen } from '../../components/agents/AgentEditorScreen'
import { useWorkspace } from '../../contexts/WorkspaceContext'

export default function AgentRoute(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { activeWorkspaceId } = useWorkspace()
  return <AgentEditorScreen key={`${activeWorkspaceId}:${id}`} agentId={id ?? 'new'} />
}
