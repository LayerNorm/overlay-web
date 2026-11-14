import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { AgentDirectMessageRoute } from '../../components/agents/AgentThreadScreen'

export default function DirectMessageRoute(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <AgentDirectMessageRoute conversationId={id} />
}
