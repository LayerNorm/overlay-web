import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { OverlayToolsOptions } from './types'
import { buildServiceAuthToken, getServiceAuthHeaderName } from '@/server/auth/service-auth'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'

export function toolAuthBody(options: OverlayToolsOptions): {
  userId: string
  accessToken?: string
  serverSecret?: string
  automationId?: string
  workspaceId?: string
  idempotencyKey?: string
} {
  return {
    userId: options.userId,
    accessToken: options.accessToken,
    serverSecret: options.serverSecret,
    automationId: options.automationId,
    workspaceId: options.workspaceId,
    idempotencyKey: options.idempotencyKey,
  }
}

/**
 * A turn's `idempotencyKey` is shared by every tool call in the turn, but the
 * server scopes a key to one request (user, method, path) and rejects its reuse
 * for a different body. Inside a tool call the key is therefore extended with
 * the call id and the request's position in the call: distinct writes get
 * distinct keys, and a replayed step re-issues the same keys in the same order.
 */
const toolCallScope = new AsyncLocalStorage<{ toolCallId: string; sequence: number }>()

export function runInToolCallScope<T>(toolCallId: string | undefined, run: () => T): T {
  return toolCallId ? toolCallScope.run({ toolCallId, sequence: 0 }, run) : run()
}

function scopedIdempotencyKey(key: string): string {
  const scope = toolCallScope.getStore()
  if (!scope) return key
  const sequence = scope.sequence
  scope.sequence += 1
  return `${key}:tool:${scope.toolCallId}:${sequence}`
}

export type InternalApiFetchOpts = {
  method?: 'POST' | 'PATCH' | 'DELETE'
  forwardCookie?: string
}

export async function callInternalApi(
  path: string,
  body: Record<string, unknown>,
  accessToken: string | undefined,
  baseUrl: string | undefined,
  opts?: InternalApiFetchOpts,
): Promise<Response> {
  const method = opts?.method ?? 'POST'
  const forwardCookie = opts?.forwardCookie
  const url = baseUrl ? `${baseUrl}${path}` : path
  const { serverSecret, workspaceId, idempotencyKey, ...serializedBody } = body
  const serviceAuthHeader =
    typeof serverSecret === 'string' && serverSecret && typeof body.userId === 'string'
      ? await buildServiceAuthToken({
          userId: body.userId,
          method,
          // Verification compares against the request pathname, without the query.
          path: path.split('?')[0]!,
        })
      : null
  return fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(serviceAuthHeader ? { [getServiceAuthHeaderName()]: serviceAuthHeader } : {}),
      ...(typeof workspaceId === 'string' && workspaceId.trim()
        ? { [ACTIVE_WORKSPACE_HEADER]: workspaceId.trim() }
        : {}),
      ...(forwardCookie ? { Cookie: forwardCookie } : {}),
      'Idempotency-Key': typeof idempotencyKey === 'string' && idempotencyKey.trim()
        ? scopedIdempotencyKey(idempotencyKey.trim())
        : randomUUID(),
    },
    body: JSON.stringify(serializedBody),
  })
}

export async function callInternalApiGet(
  pathWithQuery: string,
  accessToken: string | undefined,
  baseUrl: string | undefined,
  forwardCookie?: string,
  serverSecret?: string,
  userId?: string,
  workspaceId?: string,
): Promise<Response> {
  const urlObject = new URL(pathWithQuery, baseUrl ?? 'http://localhost')
  if (userId && !urlObject.searchParams.has('userId')) {
    urlObject.searchParams.set('userId', userId)
  }
  const url = baseUrl
    ? `${baseUrl}${urlObject.pathname}${urlObject.search}`
    : `${urlObject.pathname}${urlObject.search}`
  const serviceAuthHeader =
    serverSecret && userId
      ? await buildServiceAuthToken({
          userId,
          method: 'GET',
          path: urlObject.pathname,
        })
      : null
  return fetch(url, {
    method: 'GET',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(serviceAuthHeader ? { [getServiceAuthHeaderName()]: serviceAuthHeader } : {}),
      ...(workspaceId?.trim() ? { [ACTIVE_WORKSPACE_HEADER]: workspaceId.trim() } : {}),
      ...(forwardCookie ? { Cookie: forwardCookie } : {}),
    },
  })
}
