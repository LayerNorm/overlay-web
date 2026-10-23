'use client'

import { useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { useOptionalWorkspace } from '@/contexts/WorkspaceContext'
import { usePanelScope } from '@/hooks/use-panel-scope'
import {
  buildWorkspaceHandleHref,
  buildWorkspaceHref,
  readWorkspaceRouteTarget,
  readWorkspacePathScope,
  resolveWorkspaceSurface,
} from '@/shared/workspaces/routing'
import { validateWorkspaceHandleAddress } from '@/shared/workspaces/handle-policy'
import { parsePanelScope, type PanelScope } from '@/shared/workspaces/panel-scope'

export type WorkspaceHrefBuilder = (
  workspaceId: string | null,
  href: string,
  scope?: PanelScope,
) => string

/** Build a scoped handle address when known, and retain the immutable-ID route as a safe fallback. */
export function useWorkspaceHref(): WorkspaceHrefBuilder {
  const pathname = usePathname() ?? ''
  const workspace = useOptionalWorkspace()
  const target = readWorkspaceRouteTarget(pathname)
  const currentScope = usePanelScope()
  return useCallback((workspaceId, href, scope) => {
    const source = new URL(href, 'https://workspace.invalid')
    const pathScope = readWorkspacePathScope(source.pathname)
    const queryScope = parsePanelScope(source.searchParams.get('scope'))
    const surface = resolveWorkspaceSurface(source.pathname)
    const view = source.searchParams.get('view')
    const legacyViewScope = surface === 'agents' && (view === 'personal' || view === 'workspace')
      ? view
      : surface === 'chat' && (view === 'dms' || view === 'channels' || view === 'workspace-chats')
        ? 'workspace'
        : surface === 'chat' && view === 'personal'
          ? 'personal'
          : null
    const effectiveScope = scope ?? pathScope ?? queryScope ?? legacyViewScope ?? currentScope
    const id = workspaceId ?? (target?.kind === 'id' ? target.value : workspace?.activeWorkspaceId ?? null)
    const current = target?.kind === 'handle'
      ? workspace?.workspaces.find((item) => item.slug === target.value)
      : id
        ? workspace?.workspaces.find((item) => item.id === id)
        : workspace?.activeWorkspace
    const slug = current?.slug
    if (slug && validateWorkspaceHandleAddress(slug).ok) {
      return buildWorkspaceHandleHref(slug, href, effectiveScope)
    }
    if (id) {
      source.searchParams.set('scope', effectiveScope)
      return buildWorkspaceHref(id, `${source.pathname}${source.search}${source.hash}`)
    }
    if (target?.kind === 'handle') return buildWorkspaceHandleHref(target.value, href, effectiveScope)
    return href
  }, [currentScope, target?.kind, target?.value, workspace?.activeWorkspace, workspace?.activeWorkspaceId, workspace?.workspaces])
}
