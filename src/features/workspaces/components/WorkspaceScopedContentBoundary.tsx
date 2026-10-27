'use client'

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { WORKSPACE_CHANGED_EVENT, type WorkspaceChangedEventDetail } from '@/shared/workspaces/events'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { parsePanelScope } from '@/shared/workspaces/panel-scope'
import {
  buildWorkspaceHandleHref,
  isSupportedWorkspaceRoute,
  isWorkspaceNavigationPending,
  isWorkspaceRouteTargetPending,
  parseWorkspaceHandleRoute,
  readWorkspaceRouteDescriptor,
  readWorkspaceIdFromPath,
  readWorkspacePathScope,
  readWorkspaceRouteTarget,
  SCOPED_WORKSPACE_SURFACES,
} from '@/shared/workspaces/routing'
import { validateWorkspaceHandleAddress } from '@/shared/workspaces/handle-policy'

function canonicalHandleDestination(pathname: string, search: string, hash: string): string | null {
  const parsed = parseWorkspaceHandleRoute(pathname, search)
  if (!parsed) return null
  return `${parsed.canonicalPath}${parsed.canonicalSearch ? `?${parsed.canonicalSearch}` : ''}${hash}`
}

function legacyScopedDestination(args: {
  descriptor: NonNullable<ReturnType<typeof readWorkspaceRouteDescriptor>>
  pathname: string
  search: string
  routingHandle: string
  currentScope: ReturnType<typeof usePanelScope>
}): string | null {
  const { descriptor, pathname, search, routingHandle, currentScope } = args
  if (!SCOPED_WORKSPACE_SURFACES.has(descriptor.surface)
    || !isSupportedWorkspaceRoute(descriptor.surface, descriptor.suffix)) return null
  const params = new URLSearchParams(search)
  if (params.get('section') === 'account') return null
  const view = params.get('view')
  const legacyViewScope = descriptor.surface === 'agents' && (view === 'personal' || view === 'workspace')
    ? view
    : descriptor.surface === 'chat' && (view === 'dms' || view === 'channels' || view === 'workspace-chats')
      ? 'workspace'
      : descriptor.surface === 'chat' && view === 'personal' ? 'personal' : null
  const scope = descriptor.scope ?? readWorkspacePathScope(pathname)
    ?? parsePanelScope(params.get('scope'))
    ?? legacyViewScope
    ?? currentScope
  return buildWorkspaceHandleHref(routingHandle, `${pathname}${search ? `?${search}` : ''}`, scope)
}

function shouldWaitForWorkspaceContent(args: {
  switchingWorkspaceId: string | null
  waitingForNavigation: boolean
  routeTarget: ReturnType<typeof readWorkspaceRouteTarget>
  status: ReturnType<typeof useWorkspace>['status']
  currentWorkspace: ReturnType<typeof useWorkspace>['activeWorkspace']
  resolvedRouteTargetKey: string | null
  descriptor: ReturnType<typeof readWorkspaceRouteDescriptor>
}): boolean {
  const { switchingWorkspaceId, waitingForNavigation, routeTarget, status, currentWorkspace, resolvedRouteTargetKey, descriptor } = args
  return Boolean(
    switchingWorkspaceId
    || waitingForNavigation
    || (routeTarget?.kind === 'handle' && status !== 'ready')
    || (descriptor && routeTarget && status === 'ready' && !currentWorkspace)
    || isWorkspaceRouteTargetPending(routeTarget, resolvedRouteTargetKey)
  )
}

function workspaceForRouteTarget(args: {
  routeTarget: ReturnType<typeof readWorkspaceRouteTarget>
  workspaces: ReturnType<typeof useWorkspace>['workspaces']
  activeWorkspace: ReturnType<typeof useWorkspace>['activeWorkspace']
}): ReturnType<typeof useWorkspace>['activeWorkspace'] {
  const { routeTarget, workspaces, activeWorkspace } = args
  if (routeTarget?.kind === 'id') return workspaces.find((workspace) => workspace.id === routeTarget.value) ?? null
  if (routeTarget?.kind === 'handle') return workspaces.find((workspace) => workspace.slug === routeTarget.value) ?? null
  return activeWorkspace
}

function canonicalRouteDestination(args: {
  pathname: string
  search: string
  hash: string
  routeTargetKind: 'id' | 'handle' | undefined
  descriptor: ReturnType<typeof readWorkspaceRouteDescriptor>
  currentWorkspaceRoutingHandle: string | undefined
  currentScope: ReturnType<typeof usePanelScope>

}): string | null {
  const { pathname, search, hash, routeTargetKind, descriptor, currentWorkspaceRoutingHandle, currentScope,  } = args
  if (new URLSearchParams(search).get('section') === 'account') return null
  if (routeTargetKind === 'handle') return canonicalHandleDestination(pathname, search, hash)
  if (!descriptor || !currentWorkspaceRoutingHandle
    || !validateWorkspaceHandleAddress(currentWorkspaceRoutingHandle).ok) return null
  const destination = legacyScopedDestination({
    descriptor,
    pathname,
    search,
    routingHandle: currentWorkspaceRoutingHandle,
    currentScope,
  })
  return destination ? `${destination}${hash}` : null
}

function shouldBlockScopedContent(args: {
  descriptor: ReturnType<typeof readWorkspaceRouteDescriptor>
  routeTarget: ReturnType<typeof readWorkspaceRouteTarget>
  status: ReturnType<typeof useWorkspace>['status']
  currentWorkspace: ReturnType<typeof useWorkspace>['activeWorkspace']
  pathname: string
  routeSearch: string
  currentScope: ReturnType<typeof usePanelScope>

}): boolean {
  const { descriptor, routeTarget, status, currentWorkspace, pathname, routeSearch, currentScope,  } = args
  const scopedSurface = Boolean(descriptor && SCOPED_WORKSPACE_SURFACES.has(descriptor.surface))
  const metadataPending = scopedSurface && routeTarget?.kind === 'id' && status !== 'ready'
  const currentLocation = `${pathname}${routeSearch ? `?${routeSearch}` : ''}`
  const destination = canonicalRouteDestination({
    pathname,
    search: routeSearch,
    hash: '',
    routeTargetKind: routeTarget?.kind,
    descriptor,
    currentWorkspaceRoutingHandle: currentWorkspace?.routingHandle,
    currentScope,

  })
  return Boolean(metadataPending || (destination && destination !== currentLocation))
}

type WorkspaceScopedContentGateState = {
  switchingWorkspaceId: string | null
  waitingForNavigation: boolean
  routeTarget: ReturnType<typeof readWorkspaceRouteTarget>
  status: ReturnType<typeof useWorkspace>['status']
  currentWorkspace: ReturnType<typeof useWorkspace>['activeWorkspace']
  resolvedRouteTargetKey: string | null
  descriptor: ReturnType<typeof readWorkspaceRouteDescriptor>
  routeWorkspaceId: string | null
  activeWorkspaceId: string | null
  pathname: string
  routeSearch: string
  currentScope: ReturnType<typeof usePanelScope>

}

export function WorkspaceScopedContentGate({
  children,
  fallback,
  state,
}: {
  children: ReactNode
  fallback: ReactNode
  state: WorkspaceScopedContentGateState
}) {
  const {
    switchingWorkspaceId,
    waitingForNavigation,
    routeTarget,
    status,
    currentWorkspace,
    resolvedRouteTargetKey,
    descriptor,
    routeWorkspaceId,
    activeWorkspaceId,
    pathname,
    routeSearch,
    currentScope,

  } = state
  if (shouldWaitForWorkspaceContent({
    switchingWorkspaceId,
    waitingForNavigation,
    routeTarget,
    status,
    currentWorkspace,
    resolvedRouteTargetKey,
    descriptor,
  })) return fallback

  const scopeKey = `${routeWorkspaceId ?? currentWorkspace?.id ?? activeWorkspaceId ?? 'workspace-unavailable'}:${descriptor?.scope ?? currentScope}`
  if (shouldBlockScopedContent({
    descriptor,
    routeTarget,
    status,
    currentWorkspace,
    pathname,
    routeSearch,
    currentScope,

  })) return fallback
  return <Fragment key={scopeKey}>{children}</Fragment>
}

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
  const descriptor = readWorkspaceRouteDescriptor(pathname)
  const routeSearch = searchParams?.toString() ?? ''
  const currentWorkspace = workspaceForRouteTarget({ routeTarget, workspaces, activeWorkspace })

  useEffect(() => {
    const search = searchParams?.toString() ?? ''
    const hash = window.location.hash
    const current = `${pathname}${search ? `?${search}` : ''}${hash}`
    const destination = canonicalRouteDestination({
      pathname,
      search,
      hash,
      routeTargetKind: routeTarget?.kind,
      descriptor,
      currentWorkspaceRoutingHandle: currentWorkspace?.routingHandle,
      currentScope,

    })
    if (destination && current !== destination) router.replace(destination, { scroll: false })
  }, [currentScope, currentWorkspace?.routingHandle, descriptor, pathname, router, routeTarget?.kind, routeTarget?.value, searchParams])

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
  return (
    <WorkspaceScopedContentGate
      fallback={fallback}
      state={{
        switchingWorkspaceId,
        waitingForNavigation,
        routeTarget,
        status,
        currentWorkspace,
        resolvedRouteTargetKey,
        descriptor,
        routeWorkspaceId,
        activeWorkspaceId,
        pathname,
        routeSearch,
        currentScope,

      }}
    >
      {children}
    </WorkspaceScopedContentGate>
  )
}
