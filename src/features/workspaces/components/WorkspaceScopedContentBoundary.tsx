'use client'

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { WORKSPACE_CHANGED_EVENT, type WorkspaceChangedEventDetail } from '@/shared/workspaces/events'
import { useWorkspace } from './WorkspaceProvider'
import { readWorkspaceIdFromPath } from '../lib/workspace-routing'

/**
 * Keeps route content isolated from the workspace that produced it.
 *
 * Next keeps client component state when two canonical workspace URLs rewrite
 * to the same app route. During a switch we hide the previous workspace's page,
 * then remount the route subtree once navigation commits to the new workspace.
 * The sidebar remains mounted and can refresh independently.
 */
export function WorkspaceScopedContentBoundary({
  children,
  fallback,
}: {
  children: ReactNode
  fallback: ReactNode
}) {
  const pathname = usePathname() ?? ''
  const { activeWorkspaceId, switchingWorkspaceId } = useWorkspace()
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null)
  const routeWorkspaceId = readWorkspaceIdFromPath(pathname)

  useEffect(() => {
    function handleWorkspaceChanged(event: Event) {
      const detail = (event as CustomEvent<WorkspaceChangedEventDetail>).detail
      setPendingWorkspaceId(detail.workspaceId)
    }
    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged)
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged)
  }, [])

  const waitingForNavigation = Boolean(
    pendingWorkspaceId && routeWorkspaceId !== pendingWorkspaceId,
  )
  if (switchingWorkspaceId || waitingForNavigation) return fallback

  const scopeKey = routeWorkspaceId ?? activeWorkspaceId ?? 'workspace-unavailable'
  return <Fragment key={scopeKey}>{children}</Fragment>
}
