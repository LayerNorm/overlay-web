import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { ResourceDocumentScreen } from '../../components/knowledge/ResourceScreens'

export default function NoteRoute(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <ResourceDocumentScreen key={id} id={id} />
}
