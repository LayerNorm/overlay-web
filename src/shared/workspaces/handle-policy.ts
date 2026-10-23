export const WORKSPACE_HANDLE_MIN_LENGTH = 3
export const WORKSPACE_HANDLE_MAX_LENGTH = 63

const RESERVED_WORKSPACE_HANDLES = new Set([
  'about',
  'account',
  'admin',
  'api',
  'app',
  'auth',
  'blog',
  'changelog',
  'docs',
  'explore',
  'favicon',
  'home',
  'login',
  'logout',
  'oauth',
  'pricing',
  'robots',
  'settings',
  'share',
  'sign-in',
  'sign-up',
  'status',
  'support',
  'terms',
  'w',
  'www',
])

export type WorkspaceHandleValidation =
  | { ok: true; handle: string }
  | { ok: false; reason: 'invalid' | 'reserved' }

export function normalizeWorkspaceHandleInput(value: string): string {
  return value.trim().toLowerCase()
}

export function validateWorkspaceHandleInput(value: string): WorkspaceHandleValidation {
  const handle = normalizeWorkspaceHandleInput(value)
  if (
    handle.length < WORKSPACE_HANDLE_MIN_LENGTH
    || handle.length > WORKSPACE_HANDLE_MAX_LENGTH
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)
  ) {
    return { ok: false, reason: 'invalid' }
  }
  if (isReservedWorkspaceHandle(handle)) return { ok: false, reason: 'reserved' }
  return { ok: true, handle }
}

export function validateWorkspaceHandleAddress(value: string): WorkspaceHandleValidation {
  const handle = normalizeWorkspaceHandleInput(value)
  if (
    handle.length < WORKSPACE_HANDLE_MIN_LENGTH
    || handle.length > WORKSPACE_HANDLE_MAX_LENGTH
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)
  ) {
    return { ok: false, reason: 'invalid' }
  }
  if (RESERVED_WORKSPACE_HANDLES.has(handle)) return { ok: false, reason: 'reserved' }
  return { ok: true, handle }
}

export function isWorkspaceHandleSyntaxValid(handle: string): boolean {
  return handle.length >= WORKSPACE_HANDLE_MIN_LENGTH
    && handle.length <= WORKSPACE_HANDLE_MAX_LENGTH
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)
}

export function isReservedWorkspaceHandle(handle: string): boolean {
  return RESERVED_WORKSPACE_HANDLES.has(handle) || handle.startsWith('personal-')
}

export function workspaceHandleBaseFromName(name: string): string | null {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, WORKSPACE_HANDLE_MAX_LENGTH)
    .replace(/-+$/g, '')
  return base || null
}

export function buildWorkspaceHandleCandidate(base: string | null, suffix: string): string {
  const safeSuffix = suffix.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16)
  const resolvedSuffix = safeSuffix.length >= 2 ? safeSuffix : 'workspace'
  const prefix = base
    && isWorkspaceHandleSyntaxValid(base)
    && !isReservedWorkspaceHandle(base)
    ? base
    : 'workspace'
  const availablePrefixLength = WORKSPACE_HANDLE_MAX_LENGTH - resolvedSuffix.length - 1
  return `${prefix.slice(0, availablePrefixLength).replace(/-+$/g, '')}-${resolvedSuffix}`
}
