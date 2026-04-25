import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { ChatScreen } from '../../components/chat/ChatScreen'

export default function ChatConversationRoute(): React.ReactElement {
  const { id, projectId, projectName } = useLocalSearchParams<{
    id: string
    projectId?: string
    projectName?: string
  }>()

  return (
    <ChatScreen
      conversationId={id}
      projectId={projectId}
      projectName={projectName}
      routeKind="detail"
    />
  )
}
