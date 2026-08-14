import 'server-only'

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
          path,
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
        ? idempotencyKey.trim()
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
      ...(forwardCookie ? { Cookie: forwardCookie } : {}),
    },
  })
}
