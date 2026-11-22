import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { WorkOrganization } from '../../components/work/WorkOrganization'
import { useWorkspace } from '../../contexts/WorkspaceContext'

export default function WorkOrganizationRoute() {
  const { scope } = useLocalSearchParams<{ scope?: string }>()
  const { activeWorkspaceId, activeWorkspace } = useWorkspace()
  return (
    <WorkOrganization
      key={activeWorkspaceId ?? ''}
      workspaceId={activeWorkspaceId}
      workspaceName={activeWorkspace?.name}
      initialScope={scope === 'personal' ? 'personal' : 'workspace'}
    />
  )
}
