/**
 * The scope a person is looking at in the secondary panel (Personal / Workspace / Archived). It is one setting shared by
 * every page: the URL carries it as `?scope=`, and the last choice is remembered so the next page opens on it.
 * Archived is a view, not a scope: it shows what was archived from either. See docs/plans/UNIFIED_SCOPES_PLAN.md.
 */
import type { ResourceView } from './resource-scope'
import { soloPanelScope } from './solo-workspace'

export type PanelScope = ResourceView

export const PANEL_SCOPES: readonly PanelScope[] = ['personal', 'workspace', 'archived']

export const DEFAULT_PANEL_SCOPE: PanelScope = 'personal'

export const PANEL_SCOPE_PARAM = 'scope'

/** Local storage key for the remembered scope. */
export const PANEL_SCOPE_STORAGE_KEY = 'overlay:panel-scope'

export function parsePanelScope(value: unknown): PanelScope | null {
  return value === 'personal' || value === 'workspace' || value === 'archived' ? value : null
}

/**
 * The scope to show: the URL's `?scope=` wins (so a shared link opens where it was made), then the remembered choice,
 * then Personal.
 */
export function resolvePanelScope(args: {
  param: string | null | undefined
  saved?: string | null
  /** In a workspace of one person there is no Workspace scope; see `soloPanelScope`. */
  solo?: boolean
}): PanelScope {
  return soloPanelScope(parsePanelScope(args.param) ?? parsePanelScope(args.saved) ?? DEFAULT_PANEL_SCOPE, Boolean(args.solo))
}

/**
 * The `view` to ask a list for. A workspace of one person has a single list, so it asks for everything active (no view):
 * what the person made and anything shared into the workspace, such as the default agent. Archived stays its own list.
 */
export function listViewForScope(scope: PanelScope, solo: boolean): PanelScope | undefined {
  return solo && scope !== 'archived' ? undefined : scope
}

/** What a creation should default to: Archived has no New, so a create made from there lands in Personal. */
export function scopeForNewItem(scope: PanelScope): 'personal' | 'workspace' {
  return scope === 'workspace' ? 'workspace' : 'personal'
}

/**
 * The `scope` to send when creating: only `workspace` is sent, since Personal is what an absent scope means. (It also keeps
 * a new web build working against a backend that has not learned `scope` on that call yet.)
 */
export function newItemScope(scope: PanelScope): 'workspace' | undefined {
  return scope === 'workspace' ? 'workspace' : undefined
}

/** The sub-rows shown under a scope: Archived has none. */
export function scopeHasSubRows(scope: PanelScope): scope is 'personal' | 'workspace' {
  return scope !== 'archived'
}

/** Sets or clears `scope` on a copy of `params`. Personal is the default, so it stays out of the URL. */
export function withPanelScope(params: URLSearchParams, scope: PanelScope): URLSearchParams {
  const next = new URLSearchParams(params.toString())
  if (scope === DEFAULT_PANEL_SCOPE) next.delete(PANEL_SCOPE_PARAM)
  else next.set(PANEL_SCOPE_PARAM, scope)
  return next
}
