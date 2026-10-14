'use client'

import { useSearchParams } from 'next/navigation'
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

const CHANGED_EVENT = 'overlay:panel-scope-changed'

// Storage can be blocked (private browsing, some mobile Safari modes); the scope then simply is not remembered.
function readSavedPanelScope(): PanelScope | null {
  try {
    return parsePanelScope(window.localStorage.getItem(PANEL_SCOPE_STORAGE_KEY))
  } catch {
    return null
  }
}

/** Remembers the scope for the next page (the URL still carries it for the current one). */
export function rememberPanelScope(scope: PanelScope): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PANEL_SCOPE_STORAGE_KEY, scope)
  } catch {
    // Not remembered; the URL still works.
  }
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

/**
 * The remembered scope, or null on the server, on the first render, and before anything was chosen.
 *
 * It is read after mount rather than through useSyncExternalStore: a snapshot that differs from the server's during
 * hydration made the production app shell hang on its loading screen. Reading it in an effect keeps the first client
 * render identical to the server's; the saved scope applies right after.
 */
export function useSavedPanelScope(): PanelScope | null {
  const [saved, setSaved] = useState<PanelScope | null>(null)
  useEffect(() => {
    const read = () => setSaved(readSavedPanelScope())
    read()
    window.addEventListener('storage', read)
    window.addEventListener(CHANGED_EVENT, read)
    return () => {
      window.removeEventListener('storage', read)
      window.removeEventListener(CHANGED_EVENT, read)
    }
  }, [])
  return saved
}

/**
 * The scope every scoped page shows: `?scope=` in the URL, else the remembered choice, else Personal.
 * Pages that list resources read it here so they always agree with the secondary panel.
 */
export function usePanelScope(): PanelScope {
  const params = useSearchParams()
  const saved = useSavedPanelScope()
  const solo = useIsSoloWorkspace()
  const param = parsePanelScope(params?.get(PANEL_SCOPE_PARAM))
  // A scope arriving in the URL (a shared link, a deep link) becomes the remembered one, so links inside the page that
  // carry no `scope` keep showing it.
  useEffect(() => {
    if (param && param !== saved) rememberPanelScope(param)
  }, [param, saved])
  return resolvePanelScope({ param, saved, solo })
}

/** The `view` for a list request: undefined (everything active) in a workspace of one person, the scope otherwise. */
export function usePanelListView(): PanelScope | undefined {
  const scope = usePanelScope()
  return listViewForScope(scope, useIsSoloWorkspace())
}
