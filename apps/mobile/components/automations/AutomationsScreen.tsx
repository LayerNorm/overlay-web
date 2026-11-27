import React from 'react'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { AutomationBrowserScreen } from './AutomationBrowserScreen'

export function AutomationsScreen() {
  const { activeWorkspaceId } = useWorkspace()
  return <AutomationBrowserScreen key={activeWorkspaceId} />
}
