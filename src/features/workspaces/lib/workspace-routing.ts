const FALLBACK_SURFACE = 'chat'
const APP_SURFACES = new Set([
  'activity',
  'admin',
  'agents',
  'automations',
  'chat',
  'files',
  'knowledge',
  'memories',
  'notes',
  'outputs',
  'projects',
  'settings',
  'tools',
])

export function readWorkspaceIdFromPath(pathname: string): string | null {
  const match = /^\/app\/w\/([^/]+)(?:\/|$)/.exec(pathname)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1]).trim() || null
  } catch {
    return null
  }
}

export function resolveWorkspaceSurface(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'app') return FALLBACK_SURFACE
  const candidate = segments[1] === 'w' ? segments[3] : segments[1]
  return candidate && APP_SURFACES.has(candidate) ? candidate : FALLBACK_SURFACE
}

export function buildWorkspaceHref(workspaceId: string, pathname: string): string {
  return `/app/w/${encodeURIComponent(workspaceId)}/${resolveWorkspaceSurface(pathname)}`
}

/**
 * Base path for chat query updates (`?id=`).
 * Prefer the browser/workspace path so soft navigations stay on
 * `/app/w/:workspaceId/chat` instead of rewriting to bare `/app/chat`.
 */
export function resolveChatBasePath(pathname: string | null | undefined): string {
  if (!pathname) return '/app/chat'
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
