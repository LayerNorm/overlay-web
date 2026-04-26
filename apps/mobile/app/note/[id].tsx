import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { NoteEditor } from '../../components/notes/NoteEditor'

export default function NoteRoute(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <NoteEditor noteId={id} />
}
