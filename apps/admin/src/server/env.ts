import 'server-only'

const isDev = process.env.NODE_ENV !== 'production'

function devFallback(name: string): string | undefined {
  return isDev ? process.env[`DEV_${name}`] : undefined
}

/** HTTP endpoint of the Convex deployment the admin console talks to. */
export function convexHttpUrl(): string {
  const url = (
    process.env.ADMIN_CONVEX_URL
    ?? devFallback('NEXT_PUBLIC_CONVEX_URL')
    ?? process.env.NEXT_PUBLIC_CONVEX_URL
    ?? ''
  ).trim().replace(/\/+$/, '')
  if (!url) {
    throw new Error('Convex URL is not configured (set ADMIN_CONVEX_URL or NEXT_PUBLIC_CONVEX_URL)')
  }
  return url
}

/** Dedicated operator secret, distinct from the customer web server secret. */
export function adminApiSecret(): string {
  const secret = (process.env.ADMIN_API_SECRET ?? '').trim()
  if (!secret) {
    throw new Error('ADMIN_API_SECRET is not configured')
  }
  return secret
}

export function adminSessionSecret(): string {
  const secret = (process.env.ADMIN_SESSION_SECRET ?? '').trim()
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET is not configured')
  }
  return secret
}

/** Comma-separated WorkOS user ids permitted to sign in to the admin console. */
export function allowedUserIds(): ReadonlySet<string> {
  const raw = process.env.ADMIN_ALLOWED_USER_IDS ?? ''
  return new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))
}

export function workosClientId(): string {
  const id = (process.env.WORKOS_CLIENT_ID ?? devFallback('WORKOS_CLIENT_ID') ?? '').trim()
  if (!id) {
    throw new Error('WORKOS_CLIENT_ID is not configured')
  }
  return id
}

export function workosApiKey(): string {
  const key = (process.env.WORKOS_API_KEY ?? devFallback('WORKOS_API_KEY') ?? '').trim()
  if (!key) {
    throw new Error('WORKOS_API_KEY is not configured')
  }
  return key
}

/** Optional Composio key for the live connector catalog (best effort). */
export function composioApiKey(): string | undefined {
  const key = (process.env.COMPOSIO_API_KEY ?? '').trim()
  return key || undefined
}

/** Public Convex URL exposed to the browser for the CSP connect-src list. */
export function publicConvexUrl(): string | undefined {
  const url = (
    process.env.ADMIN_CONVEX_URL
    ?? devFallback('NEXT_PUBLIC_CONVEX_URL')
    ?? process.env.NEXT_PUBLIC_CONVEX_URL
    ?? ''
  ).trim().replace(/\/+$/, '')
  return url || undefined
}
