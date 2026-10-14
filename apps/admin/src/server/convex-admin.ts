import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'

import { adminApiSecret, convexHttpUrl } from './env'

/**
 * Carries the authenticated operator's WorkOS access token through the
 * request lifecycle so Convex `admin/console:*` functions can verify it via
 * `requireOperator` (Convex auth + JWKS). Routes run inside
 * `runWithOperatorAccessToken`.
 */
const operatorTokenStore = new AsyncLocalStorage<{ accessToken: string }>()

export function runWithOperatorAccessToken<T>(accessToken: string, run: () => T): T {
  return operatorTokenStore.run({ accessToken }, run)
}

export class ConvexAdminError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ConvexAdminError'
  }
}

type ConvexPostType = 'mutation' | 'query'

type ConvexResponse<T> = {
  errorMessage?: string
  status?: string
  value?: T
}

/**
 * The ONLY module in this app that talks to Convex. Every call injects
 * `serverSecret` from `ADMIN_API_SECRET`; callers never handle the secret.
 * Calls target the `admin/console:*` functions, which also verify the
 * forwarded operator WorkOS token (requireOperator).
 */
async function post<T>(
  type: ConvexPostType,
  path: string,
  args: Record<string, unknown>,
): Promise<T> {
  const sanitized = { ...args }
  delete sanitized.serverSecret
  const accessToken = operatorTokenStore.getStore()?.accessToken
  const response = await fetch(`${convexHttpUrl()}/api/${type}`, {
    body: JSON.stringify({
      args: { ...sanitized, serverSecret: adminApiSecret() },
      format: 'json',
      path,
    }),
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    method: 'POST',
  })
  if (!response.ok) {
    throw new ConvexAdminError(`Convex ${type} ${path} failed (HTTP ${response.status})`, response.status)
  }
  const body = (await response.json().catch(() => null)) as ConvexResponse<T> | null
  if (!body || body.status !== 'success') {
    throw new ConvexAdminError(body?.errorMessage ?? `Convex ${type} ${path} returned an invalid response`)
  }
  return body.value as T
}

export const adminConvexClient = {
  mutation: <T>(path: string, args: Record<string, unknown> = {}, _options?: { throwOnError?: boolean }) =>
    post<T>('mutation', path, args),
  query: <T>(path: string, args: Record<string, unknown> = {}, _options?: { throwOnError?: boolean }) =>
    post<T>('query', path, args),
}

export const adminConvexQuery = adminConvexClient.query
export const adminConvexMutation = adminConvexClient.mutation
