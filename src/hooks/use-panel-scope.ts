'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useSyncExternalStore } from 'react'
import {
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

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(CHANGED_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(CHANGED_EVENT, onChange)
  }
}

/** The remembered scope, or null on the server and before anything was chosen. */
export function useSavedPanelScope(): PanelScope | null {
  return useSyncExternalStore(subscribe, readSavedPanelScope, () => null)
}

/**
 * The scope every scoped page shows: `?scope=` in the URL, else the remembered choice, else Personal.
 * Pages that list resources read it here so they always agree with the secondary panel.
 */
export function usePanelScope(): PanelScope {
  const params = useSearchParams()
  const saved = useSavedPanelScope()
  const param = parsePanelScope(params?.get(PANEL_SCOPE_PARAM))
  // A scope arriving in the URL (a shared link, a deep link) becomes the remembered one, so links inside the page that
  // carry no `scope` keep showing it.
  useEffect(() => {
    if (param && param !== saved) rememberPanelScope(param)
  }, [param, saved])
  return resolvePanelScope({ param, saved })
}
