import 'server-only'

import { adminConvexSecret, convexHttpUrl } from './env'

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
 * `serverSecret` from `ADMIN_CONVEX_SECRET`; callers never handle the secret.
 * Stage 2 swaps the function paths/secret name behind this file's API.
 */
async function post<T>(
  type: ConvexPostType,
  path: string,
  args: Record<string, unknown>,
): Promise<T> {
  const sanitized = { ...args }
  delete sanitized.serverSecret
  const response = await fetch(`${convexHttpUrl()}/api/${type}`, {
    body: JSON.stringify({
      args: { ...sanitized, serverSecret: adminConvexSecret() },
      format: 'json',
      path,
    }),
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
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
