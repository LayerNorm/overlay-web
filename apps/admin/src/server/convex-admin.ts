import 'server-only'

/**
 * The ONLY module in this app allowed to talk to Convex. Every query/mutation
 * goes through `convexAdmin.query` / `convexAdmin.mutation` with
 * `serverSecret` — string paths are used (same convention as the web BFF), no
 * typed `_generated` API.
 *
 * The secret is read exactly once here (`getAdminConvexSecret`); nothing else
 * in the app may read `ADMIN_CONVEX_SECRET` — enforced by ESLint.
 */
import { ConvexError } from 'convex/values'
import { resolveAdminConvexUrl } from '@/server/convex-url'
import { optionalEnv, requiredEnv } from '@/server/env'

type ConvexPathArgs = Record<string, unknown>

function getAdminConvexSecret(): string {
  // Stage 1 reads ADMIN_CONVEX_SECRET (local dev = dev backend's internal
  // secret). Stage 3 deploys set ADMIN_API_SECRET instead; accept either name
  // so the same code runs against both environments.
  return (
    optionalEnv('ADMIN_API_SECRET') ??
    optionalEnv('ADMIN_CONVEX_SECRET') ??
    requiredEnv('ADMIN_API_SECRET')
  )
}

export function adminServerSecret(): string {
  return getAdminConvexSecret()
}

function logConvexError(kind: string, path: string, error: unknown) {
  // Avoid importing the web app's logger; keep a single terse console path.
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[convex-admin] ${kind} ${path} failed: ${message}`)
}

async function callConvex(
  kind: 'query' | 'mutation',
  path: string,
  args: ConvexPathArgs,
): Promise<unknown> {
  const url = `${resolveAdminConvexUrl().replace(/\/+$/, '')}/api/${kind}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
    cache: 'no-store',
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    logConvexError(kind, path, new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`))
    throw new ConvexError(`Convex ${kind} ${path} failed (HTTP ${response.status})`)
  }
  const payload = (await response.json()) as {
    status: string
    value?: unknown
    errorMessage?: string
  }
  if (payload.status !== 'success') {
    const message = payload.errorMessage ?? `Convex ${kind} ${path} failed`
    logConvexError(kind, path, new Error(message))
    throw new ConvexError(message)
  }
  return payload.value
}

/**
 * Drop-in for the web app's `lazyConvex` client: same call shape
 * (`query<T>(path, args, { throwOnError })`) so ported repositories need only
 * their import line changed. The options argument is accepted and ignored —
 * this client always throws on Convex errors.
 */
export const convexAdmin = {
  query<T = unknown>(path: string, args: ConvexPathArgs = {}, _options?: { throwOnError?: boolean }): Promise<T> {
    return callConvex('query', path, args) as Promise<T>
  },
  mutation<T = unknown>(path: string, args: ConvexPathArgs = {}, _options?: { throwOnError?: boolean }): Promise<T> {
    return callConvex('mutation', path, args) as Promise<T>
  },
}
