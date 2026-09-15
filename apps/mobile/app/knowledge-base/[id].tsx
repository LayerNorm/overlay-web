import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { KnowledgeBaseScreen } from '../../components/knowledge-bases/KnowledgeBaseScreen'

export default function KnowledgeBaseRoute(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <KnowledgeBaseScreen knowledgeBaseId={id ?? ''} />
}
