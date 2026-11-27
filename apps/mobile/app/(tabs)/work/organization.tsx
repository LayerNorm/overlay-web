import React from 'react'
import { WorkOrganization } from '../../../components/work/WorkOrganization'
import { useWorkspace } from '../../../contexts/WorkspaceContext'

export default function WorkOrganizationRoute() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace()
  return (
    <WorkOrganization
      key={activeWorkspaceId ?? ''}
      workspaceId={activeWorkspaceId}
      workspaceName={activeWorkspace?.name}
    />
  )
}
