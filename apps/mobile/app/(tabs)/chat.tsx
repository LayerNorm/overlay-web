import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { ChatScreen } from '../../components/chat/ChatScreen'

export default function ChatTabScreen(): React.ReactElement {
  const { newChatIntent } = useLocalSearchParams<{ newChatIntent?: string | string[] }>()
  return <ChatScreen routeKind="tab" newChatIntent={typeof newChatIntent === 'string' ? newChatIntent : undefined} />
}
