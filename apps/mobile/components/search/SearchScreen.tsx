import React from 'react'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { WorkspaceSearchScreen } from './WorkspaceSearchScreen'

export function SearchScreen() {
  const { activeWorkspaceId } = useWorkspace()
  return <WorkspaceSearchScreen key={activeWorkspaceId} />
}
