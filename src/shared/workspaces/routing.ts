import { validateWorkspaceHandleAddress } from './handle-policy'

const FALLBACK_SURFACE = 'chat'
export const APP_SURFACES = new Set([
  'activity',
  'admin',
  // Missing here, buildWorkspaceHref falls back to 'chat', so selecting Archived
  // silently navigated to /app/w/:id/chat — the new personal chat page.
  'archived',
  'agents',
  'automations',
  'chat',
  'files',
  'memories',
  'notes',
  'outputs',
  'settings',
  'tools',
  'work',
])

export function readWorkspaceIdFromPath(pathname: string): string | null {
  const match = /^\/app\/w\/([^/]+)(?:\/|$)/.exec(pathname)
  if (!match?.[1]) return null
  try {
    const workspaceId = decodeURIComponent(match[1]).trim()
    return workspaceId && !/[\/\\?#]/.test(workspaceId) ? workspaceId : null
  } catch {
    return null
  }
}

export type WorkspaceRouteTarget =
  | { kind: 'id'; value: string }
  | { kind: 'handle'; value: string }

export function workspaceRouteTargetKey(target: WorkspaceRouteTarget | null): string | null {
  return target ? `${target.kind}:${target.value}` : null
}

export function isWorkspaceRouteTargetPending(
  target: WorkspaceRouteTarget | null,
  resolvedTargetKey: string | null,
): boolean {
  const key = workspaceRouteTargetKey(target)
  return key !== null && key !== resolvedTargetKey
}

export function buildCanonicalWorkspaceRedirectLocation(
  pathname: string,
  search: string,
  canonicalHandle: string,
): string | null {
  const validation = validateWorkspaceHandleAddress(canonicalHandle)
  const routeTarget = readWorkspaceRouteTarget(pathname)
  const prefix = /^\/w\/[^/]+/.exec(pathname)?.[0]
  if (validation.ok === false || routeTarget?.kind !== 'handle' || !prefix) return null
  const suffix = pathname.slice(prefix.length)
  const parts = suffix.split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part) } catch { return '' }
  })
  const surface = parts[0] ?? 'work'
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('/') || part.includes('\\'))) {
    return null
  }
  if (!isSupportedWorkspaceRoute(surface, parts.slice(1))) return null
  return `/w/${encodeURIComponent(validation.handle)}${suffix}${search.startsWith('?') ? search : ''}`
}

export function readWorkspaceRouteTarget(pathname: string): WorkspaceRouteTarget | null {
  const id = readWorkspaceIdFromPath(pathname)
  if (id) return { kind: 'id', value: id }
  const match = /^\/w\/([^/]+)(?:\/|$)/.exec(pathname)
  if (!match?.[1]) return null
  try {
    const handle = decodeURIComponent(match[1]).trim().toLowerCase()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle) || handle.length < 3 || handle.length > 63) {
      return null
    }
    return { kind: 'handle', value: handle }
  } catch {
    return null
  }
}

export function isWorkspaceNavigationPending(args: {
  activeWorkspaceId: string | null
  pendingWorkspaceId: string | null
  routeWorkspaceId: string | null
}): boolean {
  if (!args.pendingWorkspaceId) return false
  // Canonical workspace URLs commit when the pathname reaches the target.
  // Compatibility routes such as /app/settings and /app/automations do not
  // carry a workspace segment, so the activated workspace is their commit
  // signal instead.
  return args.routeWorkspaceId
    ? args.routeWorkspaceId !== args.pendingWorkspaceId
    : args.activeWorkspaceId !== args.pendingWorkspaceId
}

export function isSupportedWorkspaceRoute(surface: string, suffix: readonly string[]): boolean {
  if (!APP_SURFACES.has(surface)) return false
  const maxSuffixParts = new Set(['agents', 'automations', 'files', 'notes', 'outputs']).has(surface) ? 1 : 0
  return suffix.length <= maxSuffixParts
}

export function resolveWorkspaceSurface(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'w') {
    const candidate = segments[2]
    return candidate ? APP_SURFACES.has(candidate) ? candidate : FALLBACK_SURFACE : 'work'
  }
  if (segments[0] !== 'app') return FALLBACK_SURFACE
  const candidate = segments[1] === 'w' ? segments[3] : segments[1]
  return candidate ? APP_SURFACES.has(candidate) ? candidate : FALLBACK_SURFACE : FALLBACK_SURFACE
}

export function buildWorkspaceHref(workspaceId: string, pathname: string): string {
  return `/app/w/${encodeURIComponent(workspaceId)}/${resolveWorkspaceSurface(pathname)}`
}

export function buildWorkspaceHandleHref(handle: string, pathname: string): string {
  return `/w/${encodeURIComponent(handle)}/${resolveWorkspaceSurface(pathname)}`
}

/**
 * Base path for chat query updates (`?id=`).
 * Prefer the browser/workspace path so soft navigations stay on
 * `/app/w/:workspaceId/chat` instead of rewriting to bare `/app/chat`.
 */
export function resolveChatBasePath(pathname: string | null | undefined): string {
  if (!pathname) return '/app/chat'
  const routeTarget = readWorkspaceRouteTarget(pathname)
  if (routeTarget?.kind === 'handle') return buildWorkspaceHandleHref(routeTarget.value, '/chat')
  const workspaceId = readWorkspaceIdFromPath(pathname)
  if (workspaceId) return buildWorkspaceHref(workspaceId, '/app/chat')
  if (pathname === '/app/chat' || pathname.startsWith('/app/chat/')) return '/app/chat'
  if (pathname === '/app/automations' || pathname.startsWith('/app/automations/')) {
    return '/app/automations'
  }
  return '/app/chat'
}

/** True when both paths are the same chat surface (workspace-aware). */
export function isSameChatSurface(
  pathname: string | null | undefined,
  chatBaseHref: string,
): boolean {
  return resolveChatBasePath(pathname) === resolveChatBasePath(chatBaseHref)
}
