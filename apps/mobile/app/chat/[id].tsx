import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { ChatScreen } from '../../components/chat/ChatScreen'

export default function ChatConversationRoute(): React.ReactElement {
  const { id } = useLocalSearchParams<{
    id: string
  }>()

  return (
    <ChatScreen
      conversationId={id}
      routeKind="detail"
    />
  )
}
