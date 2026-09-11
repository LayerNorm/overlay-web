'use client'

import { useMemo, type ReactNode } from 'react'
import { createShowcaseWorkspaceClient } from '@/features/showcase/showcase-workspace-client'
import { SHOWCASE_WORKSPACES } from '@/features/showcase/showcase-data'
import { WorkspaceAppBoundary } from '@/features/workspaces/components/WorkspaceAppBoundary'

/**
 * App-layer composition: wires the showcase workspace client into the
 * workspaces boundary so features/workspaces never imports features/showcase.
 */
export function WorkspaceAppBoundaryWithShowcase({
  children,
  hasAuthenticatedUser,
  publicShowcase,
}: {
  children: ReactNode
  hasAuthenticatedUser: boolean
  publicShowcase?: boolean
}) {
  const showcaseClient = useMemo(
    () => createShowcaseWorkspaceClient(SHOWCASE_WORKSPACES),
    [],
  )
  return (
    <WorkspaceAppBoundary
      hasAuthenticatedUser={hasAuthenticatedUser}
      publicShowcase={publicShowcase}
      showcaseClient={showcaseClient}
    >
      {children}
    </WorkspaceAppBoundary>
  )
}
