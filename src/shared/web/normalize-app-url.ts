export const DEFAULT_APP_URL = 'https://overlay.works'

/** Stable string for app base (no trailing slash on origin-only URLs). */
export function formatParsedBaseUrl(u: URL): string {
  if (u.pathname === '/' && !u.search && !u.hash) {
    return u.origin
  }
  return `${u.origin}${u.pathname}${u.search}${u.hash}`
}

/**
 * Env vars are often set to `localhost:3000` without a scheme; `new URL()` then throws Invalid URL.
 */
export function normalizeAppBaseUrl(raw: string | undefined, fallback: string): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) {
    return fallback
  }
  try {
    const u = new URL(trimmed)
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return formatParsedBaseUrl(u)
    }
  } catch {
    // continue to scheme prepending
  }
  if (trimmed.includes('://')) {
    return fallback
  }
  const hostPort = trimmed.split('/')[0] ?? trimmed
  const hostname = (hostPort.split(':')[0] ?? '').toLowerCase()
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1'
  const prefixed = `${isLocal ? 'http' : 'https'}://${trimmed}`
  try {
    return formatParsedBaseUrl(new URL(prefixed))
  } catch {
    return fallback
  }
}

export function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}
