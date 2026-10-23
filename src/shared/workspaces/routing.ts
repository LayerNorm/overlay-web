import { validateWorkspaceHandleAddress } from './handle-policy'
import { parsePanelScope, type PanelScope } from './panel-scope'

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

export const SCOPED_WORKSPACE_SURFACES = new Set([
  'work',
  'agents',
  'chat',
  'files',
  'notes',
  'outputs',
  'tools',
  'automations',
])

const HANDLE_ONLY_UNSCOPED_SURFACES = new Set(['settings', 'archived', 'memories'])
const ENCODED_SEPARATOR = /%(?:2f|5c)/i

export type ParsedWorkspaceHandleRoute = {
  handle: string
  scope: PanelScope | null
  surface: string
  suffix: readonly string[]
  canonicalPath: string
  canonicalSearch: string
  explicitScope: boolean
  legacy: boolean
}

function decodeRouteSegments(rawSegments: readonly string[]): string[] | null {
  const decoded: string[] = []
  for (const raw of rawSegments) {
    if (!raw || ENCODED_SEPARATOR.test(raw)) return null
    try {
      const part = decodeURIComponent(raw)
      if (!part || part === '.' || part === '..' || /[\/\\]/.test(part)) return null
      decoded.push(part)
    } catch {
      return null
    }
  }
  return decoded
}

export function legacyWorkspaceScopeForRoute(surface: string, params: URLSearchParams): PanelScope | null {
  const scope = parsePanelScope(params.get('scope'))
  if (scope) return scope
  const view = params.get('view')
  if (surface === 'agents' && (view === 'personal' || view === 'workspace')) return view
  if (surface === 'chat' && (view === 'dms' || view === 'channels' || view === 'workspace-chats')) {
    return 'workspace'
  }
  if (surface === 'chat' && view === 'personal') return 'personal'
  return null
}

const legacyScopeFromSearch = legacyWorkspaceScopeForRoute

export type ChatRouteView = 'personal' | 'workspace-chats' | 'dms' | 'channels'

export function normalizeChatViewForScope(scope: PanelScope, view: string | null | undefined): ChatRouteView {
  if (scope === 'personal') return 'personal'
  return view === 'dms' || view === 'channels' ? view : 'workspace-chats'
}

export function mergeHrefSearchParams(href: string, params: URLSearchParams): string {
  const destination = new URL(href, 'https://workspace.invalid')
  params.forEach((value, key) => destination.searchParams.set(key, value))
  return `${destination.pathname}${destination.search}${destination.hash}`
}

function canonicalHandlePath(
  handle: string,
  scope: PanelScope | null,
  surface: string,
  suffix: readonly string[],
): string {
  const prefix = `/w/${encodeURIComponent(handle)}`
  const feature = [surface, ...suffix].map(encodeURIComponent).join('/')
  if (scope) return `${prefix}/${scope}/${feature}`
  return `${prefix}/${feature}`
}

type HandleRouteShape = {
  surface: string
  suffix: string[]
  scope: PanelScope | null
  explicitScope: boolean
  legacy: boolean
}

function parseHandleRouteShape(remaining: string[], params: URLSearchParams): HandleRouteShape {
  const first = remaining[0]
  if (!first) {
    return {
      surface: 'work',
      suffix: [],
      scope: legacyScopeFromSearch('work', params) ?? 'personal',
      explicitScope: false,
      legacy: true,
    }
  }
  if (first === 'personal' || first === 'workspace') {
    return {
      surface: remaining[1] ?? 'work',
      suffix: remaining.slice(2),
      scope: first,
      explicitScope: true,
      legacy: remaining.length === 1,
    }
  }
  if (HANDLE_ONLY_UNSCOPED_SURFACES.has(first) || first === 'activity') {
    return {
      surface: first,
      suffix: remaining.slice(1),
      scope: first === 'activity' ? 'workspace' : null,
      explicitScope: false,
      legacy: true,
    }
  }
  return {
    surface: first,
    suffix: remaining.slice(1),
    scope: legacyScopeFromSearch(first, params) ?? 'personal',
    explicitScope: false,
    legacy: true,
  }
}

function isValidHandleRouteShape(route: HandleRouteShape): boolean {
  if (SCOPED_WORKSPACE_SURFACES.has(route.surface)) {
    return route.scope !== null && isSupportedWorkspaceRoute(route.surface, route.suffix)
  }
  if (route.surface === 'activity') {
    return route.scope === 'workspace' && route.suffix.length === 0
  }
  return HANDLE_ONLY_UNSCOPED_SURFACES.has(route.surface)
    && route.scope === null
    && route.suffix.length === 0
}

function canonicalHandleSearch(params: URLSearchParams, surface: string, scope: PanelScope | null): string {
  const canonicalParams = new URLSearchParams(params)
  canonicalParams.delete('scope')
  canonicalParams.delete('workspaceId')
  canonicalParams.delete('workspaceHandle')
  canonicalParams.delete('handle')
  if (surface === 'agents' && (canonicalParams.get('view') === 'personal' || canonicalParams.get('view') === 'workspace')) {
    canonicalParams.delete('view')
  }
  if (surface === 'chat' && scope) {
    canonicalParams.set('view', normalizeChatViewForScope(scope, canonicalParams.get('view')))
  }
  return canonicalParams.toString()
}

/**
 * Parses handle URLs and returns their canonical scoped destination. Legacy unscoped
 * feature routes are accepted here only so the proxy can redirect them before data loads.
 */
export function parseWorkspaceHandleRoute(
  pathname: string,
  search = '',
): ParsedWorkspaceHandleRoute | null {
  const raw = pathname.split('/').filter(Boolean)
  if (raw[0] !== 'w' || !raw[1]) return null
  const segments = decodeRouteSegments(raw.slice(1))
  if (!segments) return null
  const validation = validateWorkspaceHandleAddress(segments[0] ?? '')
  if (validation.ok === false) return null
  const handle = validation.handle
  const remaining = segments.slice(1)
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const route = parseHandleRouteShape(remaining, params)
  if (!isValidHandleRouteShape(route)) return null
  const canonicalSearch = canonicalHandleSearch(params, route.surface, route.scope)
  return {
    handle,
    scope: route.scope,
    surface: route.surface,
    suffix: route.suffix,
    canonicalPath: canonicalHandlePath(handle, route.scope, route.surface, route.suffix),
    canonicalSearch,
    explicitScope: route.explicitScope,
    legacy: route.legacy,
  }
}

export function readWorkspacePathScope(pathname: string): PanelScope | null {
  const parsed = parseWorkspaceHandleRoute(pathname)
  if (parsed?.explicitScope) return parsed.scope
  const parts = pathname.split('/').filter(Boolean)
  const routeScope = parts[0] === 'app'
    ? parts[1] === 'w' ? parts[3] : parts[1]
    : null
  return routeScope === 'personal' || routeScope === 'workspace' ? routeScope : null
}

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
  const parsed = parseWorkspaceHandleRoute(pathname, search)
  if (validation.ok === false || !parsed) return null
  const location = canonicalHandlePath(validation.handle, parsed.scope, parsed.surface, parsed.suffix)
  return parsed.canonicalSearch ? `${location}?${parsed.canonicalSearch}` : location
}

export function readWorkspaceRouteTarget(pathname: string): WorkspaceRouteTarget | null {
  const id = readWorkspaceIdFromPath(pathname)
  if (id) return { kind: 'id', value: id }
  const match = /^\/w\/([^/]+)(?:\/|$)/.exec(pathname)
  if (!match?.[1]) return null
  try {
    const validation = validateWorkspaceHandleAddress(decodeURIComponent(match[1]).trim())
    if (validation.ok === false) return null
    return { kind: 'handle', value: validation.handle }
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
  if (!SCOPED_WORKSPACE_SURFACES.has(surface) && surface !== 'activity') return false
  const maxSuffixParts = surface === 'agents' ? 1 : 0
  return suffix.length <= maxSuffixParts
}

export function isSupportedLegacyWorkspaceRoute(surface: string, suffix: readonly string[]): boolean {
  return APP_SURFACES.has(surface) && suffix.length <= (surface === 'agents' ? 1 : 0)
}

function routePartsFromPath(pathname: string): {
  surface: string
  suffix: string[]
  scope: PanelScope | null
} | null {
  const handleRoute = parseWorkspaceHandleRoute(pathname)
  if (handleRoute) {
    return { surface: handleRoute.surface, suffix: [...handleRoute.suffix], scope: handleRoute.scope }
  }
  const raw = pathname.split('/').filter(Boolean)
  if (raw[0] !== 'app') return null
  const offset = raw[1] === 'w' ? 3 : 1
  const parts = decodeRouteSegments(raw.slice(offset))
  if (!parts?.length) return null
  if (parts[0] === 'personal' || parts[0] === 'workspace') {
    return {
      scope: parts[0],
      surface: parts[1] ?? 'work',
      suffix: parts.slice(2),
    }
  }
  return { scope: null, surface: parts[0]!, suffix: parts.slice(1) }
}

export type WorkspaceRouteDescriptor = {
  workspaceId: string | null
  handle: string | null
  scope: PanelScope | null
  surface: string
  suffix: string[]
}

export function workspaceMetadataForHref<T extends { id: string; slug?: string | null }>(args: {
  workspaceId?: string | null
  routeTarget: { kind: 'id' | 'handle'; value: string } | null
  workspaces: readonly T[]
  activeWorkspace: T | null
}): T | null {
  if (args.workspaceId) return args.workspaces.find((workspace) => workspace.id === args.workspaceId) ?? null
  if (args.routeTarget?.kind === 'handle') {
    return args.workspaces.find((workspace) => workspace.slug === args.routeTarget?.value) ?? null
  }
  if (args.routeTarget?.kind === 'id') {
    return args.workspaces.find((workspace) => workspace.id === args.routeTarget?.value) ?? null
  }
  return args.activeWorkspace
}

export function isWorkspaceManagementSettingsRoute(
  descriptor: WorkspaceRouteDescriptor | null,
  params: URLSearchParams,
): boolean {
  return descriptor?.surface === 'settings'
    && (params.get('section') === 'workspace' || Boolean(descriptor.handle))
}

export function readWorkspaceRouteDescriptor(pathname: string): WorkspaceRouteDescriptor | null {
  const handleRoute = parseWorkspaceHandleRoute(pathname)
  if (handleRoute) {
    return {
      workspaceId: null,
      handle: handleRoute.handle,
      scope: handleRoute.scope,
      surface: handleRoute.surface,
      suffix: [...handleRoute.suffix],
    }
  }

  const route = routePartsFromPath(pathname)
  if (!route) return null
  const knownSurface = SCOPED_WORKSPACE_SURFACES.has(route.surface)
    ? isSupportedWorkspaceRoute(route.surface, route.suffix)
    : route.surface === 'activity' || ['settings', 'archived', 'memories'].includes(route.surface)
      ? route.suffix.length === 0
      : false
  if (!knownSurface) return null
  return {
    workspaceId: readWorkspaceIdFromPath(pathname),
    handle: null,
    scope: route.scope,
    surface: route.surface,
    suffix: route.suffix,
  }
}

export function resolveWorkspaceSurface(pathname: string): string {
  const route = routePartsFromPath(pathname)
  return route && APP_SURFACES.has(route.surface) ? route.surface : FALLBACK_SURFACE
}

export function buildWorkspaceHref(workspaceId: string, pathname: string): string {
  const source = new URL(pathname, 'https://workspace.invalid')
  const route = routePartsFromPath(source.pathname)
  const surface = route && APP_SURFACES.has(route.surface) ? route.surface : resolveWorkspaceSurface(source.pathname)
  const suffix = route?.suffix ?? []
  const path = `/app/w/${encodeURIComponent(workspaceId)}/${[surface, ...suffix].map(encodeURIComponent).join('/')}`
  return `${path}${source.search}${source.hash}`
}

export function buildWorkspaceHandleHref(
  handle: string,
  pathname: string,
  explicitScope?: PanelScope,
): string {
  const validation = validateWorkspaceHandleAddress(handle)
  const canonicalHandle = validation.ok ? validation.handle : handle
  const source = new URL(pathname, 'https://workspace.invalid')
  const parsed = parseWorkspaceHandleRoute(source.pathname, source.search)
  const route = routePartsFromPath(source.pathname)
  if (!route
    || !isSupportedLegacyWorkspaceRoute(route.surface, route.suffix)
    || (route.surface === 'settings' && source.searchParams.get('section') === 'account')) return pathname
  const surface = route && APP_SURFACES.has(route.surface) ? route.surface : 'work'
  const suffix = route?.suffix ?? []
  const routeScope = parsed?.scope ?? route?.scope
  const scope = surface === 'activity'
    ? 'workspace'
    : explicitScope ?? routeScope
      ?? legacyScopeFromSearch(surface, source.searchParams)
      ?? 'personal'
  const scopedSurface = SCOPED_WORKSPACE_SURFACES.has(surface)
  const location = canonicalHandlePath(
    canonicalHandle,
    scopedSurface ? scope : surface === 'activity' ? 'workspace' : null,
    surface,
    suffix,
  )
  const params = new URLSearchParams(source.searchParams)
  params.delete('scope')
  params.delete('workspaceId')
  params.delete('workspaceHandle')
  params.delete('handle')
  if (surface === 'agents' && (params.get('view') === 'personal' || params.get('view') === 'workspace')) {
    params.delete('view')
  }
  if (surface === 'chat' && scopedSurface) {
    params.set('view', normalizeChatViewForScope(scope, params.get('view')))
  }
  const search = params.toString()
  return `${location}${search ? `?${search}` : ''}${source.hash}`
}

function workspaceSwitchSurface(pathname: string): string {
  const raw = pathname.split('/').filter(Boolean)
  let candidate: string | null = null
  if (raw[0] === 'w') {
    candidate = raw[2] === 'personal' || raw[2] === 'workspace' ? raw[3] ?? null : raw[2] ?? null
  } else if (raw[0] === 'app') {
    candidate = raw[1] === 'w'
      ? raw[3] === 'personal' || raw[3] === 'workspace' ? raw[4] ?? null : raw[3] ?? null
      : raw[1] ?? null
  }
  return candidate && APP_SURFACES.has(candidate) ? candidate : resolveWorkspaceSurface(pathname)
}

function workspaceSwitchTarget(pathname: string, surface: string): string {
  if (SCOPED_WORKSPACE_SURFACES.has(surface)) return `/app/${surface}`
  if (surface === 'activity') return '/app/activity'
  if (pathname.startsWith('/app/settings') || ['settings', 'archived', 'memories'].includes(surface)) {
    return '/app/settings'
  }
  return '/app/work'
}

function workspaceSwitchScope(
  pathname: string,
  search: string,
  currentScope: PanelScope | undefined,
): PanelScope {
  const raw = pathname.split('/').filter(Boolean)
  const rawScope = raw[0] === 'w'
    ? raw[2]
    : raw[0] === 'app'
      ? raw[1] === 'w' ? raw[3] : raw[1]
      : null
  if (rawScope === 'personal' || rawScope === 'workspace') return rawScope
  return readWorkspacePathScope(pathname)
    ?? parsePanelScope(new URLSearchParams(search).get('scope'))
    ?? currentScope
    ?? 'personal'
}

function workspaceSwitchParams(search: string, surface: string, scope: PanelScope): URLSearchParams {
  const params = new URLSearchParams(search)
  if (surface === 'chat' && scope === 'personal'
    && ['dms', 'channels', 'workspace-chats'].includes(params.get('view') ?? '')) {
    params.delete('view')
  }
  for (const key of [
    'id', 'agent', 'agentId', 'agent_id', 'task', 'taskId', 'file', 'fileId',
    'folder', 'folderId', 'note', 'noteId', 'automation', 'automationId',
    'outputId', 'toolId', 'memory', 'conversationId', 'chatId', 'thread', 'threadId', 'scope',
  ]) params.delete(key)
  return params
}

export function buildWorkspaceSwitchHref(args: {
  workspaceId: string
  handle?: string | null
  pathname: string
  search?: string
  currentScope?: PanelScope
}): string {
  const search = args.search ?? ''
  if (args.pathname.startsWith('/app/settings') && new URLSearchParams(search).get('section') === 'account') {
    return `${args.pathname}${search ? `?${search.replace(/^\?/, '')}` : ''}`
  }
  const surface = workspaceSwitchSurface(args.pathname)
  const target = workspaceSwitchTarget(args.pathname, surface)
  const scope = workspaceSwitchScope(args.pathname, search, args.currentScope)
  const params = workspaceSwitchParams(search, surface, scope)
  if (SCOPED_WORKSPACE_SURFACES.has(surface)) params.set('scope', scope)
  const query = params.toString()
  const destination = `${target}${query ? `?${query}` : ''}`
  if (args.handle && (SCOPED_WORKSPACE_SURFACES.has(surface) || ['activity', 'settings', 'archived', 'memories'].includes(surface))) {
    return buildWorkspaceHandleHref(args.handle, destination, scope)
  }
  return buildWorkspaceHref(args.workspaceId, destination)
}

/**
 * Base path for chat query updates (`?id=`).
 * Prefer the browser/workspace path so soft navigations stay on
 * `/app/w/:workspaceId/chat` instead of rewriting to bare `/app/chat`.
 */
export function resolveChatBasePath(pathname: string | null | undefined): string {
  if (!pathname) return '/app/chat'
  let source: URL
  try {
    source = new URL(pathname, 'https://workspace.invalid')
  } catch {
    return '/app/chat'
  }
  const routeTarget = readWorkspaceRouteTarget(source.pathname)
  if (routeTarget?.kind === 'handle') {
    const parsed = parseWorkspaceHandleRoute(source.pathname, source.search)
    return buildWorkspaceHandleHref(
      routeTarget.value,
      `/w/${encodeURIComponent(routeTarget.value)}/${parsed?.scope ?? 'personal'}/chat`,
      parsed?.scope ?? undefined,
    )
  }
  const workspaceId = readWorkspaceIdFromPath(source.pathname)
  if (workspaceId) return buildWorkspaceHref(workspaceId, '/app/chat')
  if (source.pathname === '/app/chat' || source.pathname.startsWith('/app/chat/')) return '/app/chat'
  if (source.pathname === '/app/automations' || source.pathname.startsWith('/app/automations/')) {
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
