import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { RoomScreen } from '../../components/chat/RoomScreen'

export default function DirectMessageRoute(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <RoomScreen conversationId={id} conversationType="dm" />
}
