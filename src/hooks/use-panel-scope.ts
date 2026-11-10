'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useIsSoloWorkspace } from '@/hooks/use-solo-workspace'
import {
  listViewForScope,
  PANEL_SCOPE_PARAM,
  PANEL_SCOPE_STORAGE_KEY,
  parsePanelScope,
  resolvePanelScope,
  type PanelScope,
} from '@/shared/workspaces/panel-scope'
import {
  legacyWorkspaceScopeForRoute,
  readWorkspacePathScope,
  readWorkspaceRouteDescriptor,
  SCOPED_WORKSPACE_SURFACES,
} from '@/shared/workspaces/routing'

const CHANGED_EVENT = 'overlay:panel-scope-changed'

// Storage can be blocked (private browsing, some mobile Safari modes); the scope then simply is not remembered.
function readSavedPanelScope(): PanelScope | null {
  try {
    return parsePanelScope(window.localStorage.getItem(PANEL_SCOPE_STORAGE_KEY))
  } catch {
    return null
  }
}

// The remembered scope as last read in this tab, shared by every caller. Undefined until it has been read once, which
// only happens after hydration, so server and first client renders still agree. Later mounts (route changes, remounts
// keyed by workspace or scope) start from it instead of from "nothing remembered", so the scope never flips back to
// Personal for a render and the page never asks for the wrong list.
let savedSnapshot: { scope: PanelScope | null } | undefined

/** Remembers the scope for the next page (the URL still carries it for the current one). */
export function rememberPanelScope(scope: PanelScope): void {
  if (typeof window === 'undefined') return
  savedSnapshot = { scope }
  try {
    window.localStorage.setItem(PANEL_SCOPE_STORAGE_KEY, scope)
  } catch {
    // Not remembered; the URL still works.
  }
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

/**
 * The remembered scope, and whether it has been read yet. Before the first read (on the server and during hydration)
 * it is unknown, not Personal.
 *
 * The first read happens after mount rather than through useSyncExternalStore: a snapshot that differs from the
 * server's during hydration made the production app shell hang on its loading screen. Reading it in an effect keeps
 * the first client render identical to the server's; every later mount starts from the shared snapshot.
 */
function useSavedPanelScopeState(): { saved: PanelScope | null; known: boolean } {
  const [snapshot, setSnapshot] = useState(savedSnapshot)
  useEffect(() => {
    const read = () => {
      savedSnapshot = { scope: readSavedPanelScope() }
      setSnapshot(savedSnapshot)
    }
    read()
    window.addEventListener('storage', read)
    window.addEventListener(CHANGED_EVENT, read)
    return () => {
      window.removeEventListener('storage', read)
      window.removeEventListener(CHANGED_EVENT, read)
    }
  }, [])
  return { saved: snapshot?.scope ?? null, known: snapshot !== undefined }
}

/** The remembered scope, or null on the server, during hydration, and before anything was chosen. */
export function useSavedPanelScope(): PanelScope | null {
  return useSavedPanelScopeState().saved
}

/**
 * The scope every scoped page shows: the URL's scope, else the remembered choice, else Personal. `known` is false
 * only while the URL names no scope and the remembered choice has not been read yet (the hydration render); callers
 * that redirect or load data wait for it instead of acting on a Personal guess.
 */
export function usePanelScopeState(): { scope: PanelScope; known: boolean } {
  const pathname = usePathname() ?? ''
  const params = useSearchParams()
  const { saved, known: savedKnown } = useSavedPanelScopeState()
  const pathScope = readWorkspacePathScope(pathname)
  const scopeLessHandleRoot = /^\/w\/[^/]+\/?$/.test(pathname)
  const queryParams = new URLSearchParams(params?.toString() ?? '')
  const routeSurface = readWorkspaceRouteDescriptor(pathname)?.surface
  const legacyScope = routeSurface && SCOPED_WORKSPACE_SURFACES.has(routeSurface)
    ? legacyWorkspaceScopeForRoute(routeSurface, queryParams)
    : null
  const param = parsePanelScope(params?.get(PANEL_SCOPE_PARAM)) ?? legacyScope
  // A scope arriving in the URL (a shared link, a deep link) becomes the remembered one, so links inside the page that
  // carry no `scope` keep showing it.
  useEffect(() => {
    if (scopeLessHandleRoot || !savedKnown) return
    const requested = pathScope ?? param
    if (requested && requested !== saved) rememberPanelScope(requested)
  }, [param, pathScope, saved, savedKnown, scopeLessHandleRoot])
  if (scopeLessHandleRoot) return { scope: 'personal', known: true }
  return {
    scope: resolvePanelScope({ pathScope, param, saved }),
    known: Boolean(pathScope ?? param) || savedKnown,
  }
}

/** The selected scope; see usePanelScopeState for whether it is settled yet. */
export function usePanelScope(): PanelScope {
  return usePanelScopeState().scope
}

/** The `view` for a list request always follows the selected feature scope. */
export function usePanelListView(): PanelScope {
  const scope = usePanelScope()
  return listViewForScope(scope, useIsSoloWorkspace())
}
