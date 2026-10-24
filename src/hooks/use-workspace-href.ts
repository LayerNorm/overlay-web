'use client'

import { useCallback, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { useOptionalWorkspace } from '@/contexts/WorkspaceContext'
import { usePanelScope } from '@/hooks/use-panel-scope'
import {
  buildWorkspaceHandleHref,
  buildWorkspaceHref,
  readWorkspaceRouteDescriptor,
  readWorkspaceRouteTarget,
  readWorkspacePathScope,
  SCOPED_WORKSPACE_SURFACES,
  workspaceMetadataForHref,
  isWorkspaceManagementSettingsRoute,
} from '@/shared/workspaces/routing'
import { validateWorkspaceHandleAddress } from '@/shared/workspaces/handle-policy'
import { parsePanelScope, type PanelScope } from '@/shared/workspaces/panel-scope'

function scopeForWorkspaceHref(
  descriptor: NonNullable<ReturnType<typeof readWorkspaceRouteDescriptor>>,
  source: URL,
  explicitScope: PanelScope | undefined,
  currentScope: PanelScope,
): PanelScope {
  const pathScope = descriptor.scope ?? readWorkspacePathScope(source.pathname)
  const queryScope = parsePanelScope(source.searchParams.get('scope'))
  const view = source.searchParams.get('view')
  const legacyViewScope = descriptor.surface === 'agents' && (view === 'personal' || view === 'workspace')
    ? view
    : descriptor.surface === 'chat' && (view === 'dms' || view === 'channels' || view === 'workspace-chats')
      ? 'workspace'
      : descriptor.surface === 'chat' && view === 'personal'
        ? 'personal'
        : null
  return explicitScope ?? pathScope ?? queryScope ?? legacyViewScope ?? currentScope
}

function isAddressableWorkspaceHref(
  descriptor: NonNullable<ReturnType<typeof readWorkspaceRouteDescriptor>>,
  source: URL,
): boolean {
  return (SCOPED_WORKSPACE_SURFACES.has(descriptor.surface)
    || isWorkspaceManagementSettingsRoute(descriptor, source.searchParams))
    && source.searchParams.get('section') !== 'account'
}

export function buildWorkspaceHrefForContext({
  workspaceId,
  href,
  scope,
  target,
  currentScope,
  workspaces,
  activeWorkspace,
}: {
  workspaceId: string | null
  href: string
  scope?: PanelScope
  target: ReturnType<typeof readWorkspaceRouteTarget>
  currentScope: PanelScope
  workspaces: NonNullable<ReturnType<typeof useOptionalWorkspace>>['workspaces']
  activeWorkspace: NonNullable<ReturnType<typeof useOptionalWorkspace>>['activeWorkspace']
}): string {
  const source = new URL(href, 'https://workspace.invalid')
  const descriptor = readWorkspaceRouteDescriptor(source.pathname)
  if (!descriptor || !isAddressableWorkspaceHref(descriptor, source)) return href
  const effectiveScope = scopeForWorkspaceHref(descriptor, source, scope, currentScope)
  const id = workspaceId ?? (target?.kind === 'id' ? target.value : activeWorkspace?.id ?? null)
  const current = workspaceMetadataForHref({
    workspaceId,
    routeTarget: target,
    workspaces,
    activeWorkspace,
  })
  const routingHandle = current?.routingHandle
  if (routingHandle && validateWorkspaceHandleAddress(routingHandle).ok) {
    return buildWorkspaceHandleHref(routingHandle, href, effectiveScope)
  }
  if (!workspaceId && target?.kind === 'handle') return buildWorkspaceHandleHref(target.value, href, effectiveScope)
  if (id) {
    if (SCOPED_WORKSPACE_SURFACES.has(descriptor.surface)) source.searchParams.set('scope', effectiveScope)
    return buildWorkspaceHref(id, `${source.pathname}${source.search}${source.hash}`)
  }
  return href
}

export type WorkspaceHrefBuilder = (
  workspaceId: string | null,
  href: string,
  scope?: PanelScope,
) => string

/** Build a scoped handle address when known, and retain the immutable-ID route as a safe fallback. */
export function useWorkspaceHref(): WorkspaceHrefBuilder {
  const pathname = usePathname() ?? ''
  const workspace = useOptionalWorkspace()
  const target = useMemo(() => readWorkspaceRouteTarget(pathname), [pathname])
  const currentScope = usePanelScope()
  return useCallback((workspaceId, href, scope) => (
    buildWorkspaceHrefForContext({
      workspaceId,
      href,
      scope,
      target,
      currentScope,
      workspaces: workspace?.workspaces ?? [],
      activeWorkspace: workspace?.activeWorkspace ?? null,
    })
  ), [currentScope, target, workspace?.activeWorkspace, workspace?.workspaces])
}
