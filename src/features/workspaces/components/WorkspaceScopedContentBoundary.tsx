'use client'

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { WORKSPACE_CHANGED_EVENT, type WorkspaceChangedEventDetail } from '@/shared/workspaces/events'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { parsePanelScope } from '@/shared/workspaces/panel-scope'
import {
  buildWorkspaceHandleHref,
  isWorkspaceNavigationPending,
  isWorkspaceRouteTargetPending,
  parseWorkspaceHandleRoute,
  readWorkspaceIdFromPath,
  readWorkspacePathScope,
  readWorkspaceRouteTarget,
  SCOPED_WORKSPACE_SURFACES,
  resolveWorkspaceSurface,
} from '@/shared/workspaces/routing'

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
  const searchParams = useSearchParams()
  const router = useRouter()
  const currentScope = usePanelScope()
  const { activeWorkspaceId, switchingWorkspaceId, status, resolvedRouteTargetKey, workspaces, activeWorkspace } = useWorkspace()
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null)
  const routeWorkspaceId = readWorkspaceIdFromPath(pathname)
  const routeTarget = readWorkspaceRouteTarget(pathname)
  const currentWorkspace = routeTarget?.kind === 'id'
    ? workspaces.find((workspace) => workspace.id === routeTarget.value) ?? null
    : activeWorkspace

  useEffect(() => {
    const search = searchParams?.toString() ?? ''
    const current = `${pathname}${search ? `?${search}` : ''}${window.location.hash}`
    if (routeTarget?.kind === 'handle') {
      const parsed = parseWorkspaceHandleRoute(pathname, search)
      if (!parsed) return
      const canonical = `${parsed.canonicalPath}${parsed.canonicalSearch ? `?${parsed.canonicalSearch}` : ''}${window.location.hash}`
      if (current !== canonical) router.replace(canonical, { scroll: false })
      return
    }
    const surface = resolveWorkspaceSurface(pathname)
    if (!SCOPED_WORKSPACE_SURFACES.has(surface) || !currentWorkspace?.slug) return
    const legacyView = searchParams?.get('view')
    const legacyViewScope = surface === 'agents' && (legacyView === 'personal' || legacyView === 'workspace')
      ? legacyView
      : surface === 'chat' && (legacyView === 'dms' || legacyView === 'channels' || legacyView === 'workspace-chats')
        ? 'workspace'
        : surface === 'chat' && legacyView === 'personal' ? 'personal' : null
    const routeScope = readWorkspacePathScope(pathname)
      ?? parsePanelScope(searchParams?.get('scope'))
      ?? legacyViewScope
      ?? currentScope
    const destination = buildWorkspaceHandleHref(
      currentWorkspace.slug,
      `${pathname}${search ? `?${search}` : ''}`,
      routeScope,
    )
    if (destination !== current) router.replace(`${destination}${window.location.hash}`, { scroll: false })
  }, [currentScope, currentWorkspace?.slug, pathname, router, routeTarget?.kind, routeTarget?.value, searchParams])

  useEffect(() => {
    function handleWorkspaceChanged(event: Event) {
      const detail = (event as CustomEvent<WorkspaceChangedEventDetail>).detail
      setPendingWorkspaceId(detail.workspaceId)
    }
    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged)
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged)
  }, [])

  const waitingForNavigation = isWorkspaceNavigationPending({
    activeWorkspaceId,
    pendingWorkspaceId,
    routeWorkspaceId,
  })
  if (
    switchingWorkspaceId
    || waitingForNavigation
    || (routeTarget?.kind === 'handle' && status !== 'ready')
    || isWorkspaceRouteTargetPending(routeTarget, resolvedRouteTargetKey)
  ) return fallback

  const scopeKey = routeWorkspaceId ?? activeWorkspaceId ?? 'workspace-unavailable'
  return <Fragment key={scopeKey}>{children}</Fragment>
}
