/**
 * Workspace identity store for the desktop renderer.
 *
 * The Overlay server scopes almost everything (agents, environments, projects,
 * files, automations, billing) to a workspace via the `x-overlay-workspace-id`
 * header. This module is the single place that header value lives on desktop.
 *
 * It is deliberately a plain module — not React state — so the central fetch
 * wrapper in `app-api-client.ts` can read it without a component tree.
 * `WorkspaceContext` mirrors this value into React for UI.
 */

export const ACTIVE_WORKSPACE_HEADER = 'x-overlay-workspace-id'

export const WORKSPACE_CHANGED_EVENT = 'overlay:workspace-changed'

const STORAGE_KEY = 'overlay-active-workspace-id'

let activeWorkspaceId: string | null = null
let hydrated = false

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function hydrate(): void {
  if (hydrated) return
  hydrated = true
  try {
    activeWorkspaceId = normalizeId(localStorage.getItem(STORAGE_KEY))
  } catch {
    activeWorkspaceId = null
  }
}

export function getActiveWorkspaceId(): string | null {
  if (activeWorkspaceId) return activeWorkspaceId
  hydrate()
  return activeWorkspaceId
}

export function setActiveWorkspaceId(id: string | null): void {
  activeWorkspaceId = normalizeId(id)
  hydrated = true
  try {
    if (activeWorkspaceId) localStorage.setItem(STORAGE_KEY, activeWorkspaceId)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Blocked storage (private browsing) must not crash the shell.
  }
}

export function clearActiveWorkspaceId(): void {
  setActiveWorkspaceId(null)
}

export function dispatchWorkspaceChanged(workspaceId: string | null): void {
  window.dispatchEvent(
    new CustomEvent<{ workspaceId: string | null }>(WORKSPACE_CHANGED_EVENT, {
      detail: { workspaceId }
    })
  )
}

export function subscribeWorkspaceChanged(
  listener: (workspaceId: string | null) => void
): () => void {
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<{ workspaceId?: string | null }>).detail
    listener(normalizeId(detail?.workspaceId))
  }
  window.addEventListener(WORKSPACE_CHANGED_EVENT, handler)
  return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handler)
}
