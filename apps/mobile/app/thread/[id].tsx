import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { RoomScreen } from '../../components/chat/RoomScreen'

/**
 * Thread route — `[id]` is the thread-root message id; `conversation` is the
 * parent room. The room screen renders the thread panel in thread mode.
 */
export default function ThreadRoute(): React.ReactElement {
  const { id, conversation, type } = useLocalSearchParams<{
    id: string
    conversation: string
    type?: 'dm' | 'channel'
  }>()
  return (
    <RoomScreen
      conversationId={conversation}
      conversationType={type ?? 'dm'}
      threadRootMessageId={id}
    />
  )
}
