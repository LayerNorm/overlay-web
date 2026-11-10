import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { WorkScreen } from '../../components/work/WorkScreen'

export default function WorkDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <WorkScreen id={id} />
}
