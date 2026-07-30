const FALLBACK_SURFACE = 'chat'
const APP_SURFACES = new Set([
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
