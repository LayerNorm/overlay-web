import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { AgentEditorScreen } from '../../components/agents/AgentEditorScreen'

export default function AgentRoute(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <AgentEditorScreen agentId={id ?? 'new'} />
}
