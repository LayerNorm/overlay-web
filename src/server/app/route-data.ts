import 'server-only'

import { connection, NextRequest } from 'next/server'
import { headers } from 'next/headers'
import type {
  AppBootstrapResponse,
  ConnectedIntegrationsResponse,
  IntegrationSearchResponse,
  KnowledgeFileNode,
  MemoryRow,
  NoteDoc,
} from '@overlay/app-core'
import { noteDocToKnowledgeFile } from '@overlay/app-core'
import type { CachedConversation } from '@/shared/chat/chat-list-cache'
import type { PaginatedEnvelope } from '@/shared/api/pagination'
import { unwrapPaginatedData } from '@/shared/api/pagination'
import { getBaseUrl } from '@/server/web/app-url'
import {
  handleAccountBffRoute,
  handleBffRoute,
  type AccountBffDomainService,
  type BffDomainService,
} from '@/app/api/v1/_utils/bff'
import * as conversationsService from '@/server/app-api/v1/conversations/route'
import * as filesService from '@/server/app-api/v1/files/route'
import * as notesService from '@/server/app-api/v1/notes/route'
import * as memoryService from '@/server/app-api/v1/memory/route'
import * as bootstrapService from '@/server/app-api/v1/bootstrap/route'
import * as integrationsService from '@/server/app-api/v1/integrations/route'
import { ACTIVE_WORKSPACE_HEADER, ROUTE_WORKSPACE_SCOPE_HEADER } from '@/shared/workspaces/constants'
import { parsePanelScope } from '@/shared/workspaces/panel-scope'
import * as workspaceHandleService from '@/server/app-api/v1/workspace-handles/[handle]/route'

const INITIAL_CHAT_LIST_LIMIT = 24

export type InitialIntegrationsRouteData = {
  bootstrap: AppBootstrapResponse | null
  connected: ConnectedIntegrationsResponse | null
  catalog: IntegrationSearchResponse | null
}

function originFromHeaders(headerList: Headers): string {
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host')
  if (!host) return getBaseUrl()

  const forwardedProto = headerList.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const proto =
    forwardedProto ||
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('[::1]')
      ? 'http'
      : 'https')

  return `${proto}://${host}`
}

/**
 * Server-side initial data loads call the v1 BFF domain services in-process via
 * the shared {@link handleBffRoute} pipeline instead of issuing an HTTP request
 * back to our own `/api/v1/*` routes. This removes the Next server -> Next API
 * route -> Convex loopback hop while preserving identical behavior (auth,
 * capability checks, rate limits, idempotency, and pagination envelopes).
 */
async function callAppApi<T>(path: string, service: BffDomainService, fallback: T): Promise<T> {
  await connection()
  const headerList = await headers()
  const cookie = headerList.get('cookie')
  let workspaceId = headerList.get(ACTIVE_WORKSPACE_HEADER)?.trim()
  const workspaceHandle = headerList.get('x-overlay-workspace-handle')?.trim()
  if (workspaceHandle) {
    const resolverUrl = new URL(
      `/api/v1/workspace-handles/${encodeURIComponent(workspaceHandle)}`,
      originFromHeaders(headerList),
    )
    const resolverRequest = new NextRequest(resolverUrl, {
      headers: { ...(cookie ? { cookie } : {}) },
    })
    const resolution = await handleAccountBffRoute(
      resolverRequest,
      { params: Promise.resolve({ handle: workspaceHandle }) },
      workspaceHandleService.GET as AccountBffDomainService,
      { requireSession: true },
    )
    if (!resolution.ok) return fallback
    const resolved = await resolution.json().catch((_error) => null) as { workspaceId?: unknown } | null
    if (typeof resolved?.workspaceId !== 'string' || !resolved.workspaceId) return fallback
    workspaceId = resolved.workspaceId
  }
  const url = new URL(path, originFromHeaders(headerList))
  const request = new NextRequest(url, {
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(workspaceId ? { [ACTIVE_WORKSPACE_HEADER]: workspaceId } : {}),
    },
  })
  const response = await handleBffRoute(request, {}, service)
  if (!response.ok) return fallback
  const value = await response.json().catch((_error) => fallback)
  if (Array.isArray(fallback)) {
    return unwrapPaginatedData(value as unknown, fallback as unknown[]) as T
  }
  return value as T
}

export function getInitialChatHistory(): Promise<PaginatedEnvelope<CachedConversation> | null> {
  return (async () => {
    const headerList = await headers()
    const scope = parsePanelScope(headerList.get(ROUTE_WORKSPACE_SCOPE_HEADER)) ?? 'personal'
    return callAppApi<PaginatedEnvelope<CachedConversation> | null>(
      `/api/v1/conversations?limit=${INITIAL_CHAT_LIST_LIMIT}&view=personal&scope=${scope}`,
      conversationsService.GET as BffDomainService,
      null,
    )
  })()
}

export async function getInitialKnowledgeFiles(): Promise<KnowledgeFileNode[]> {
  const headerList = await headers()
  const scope = parsePanelScope(headerList.get(ROUTE_WORKSPACE_SCOPE_HEADER)) ?? 'personal'
  const [files, notes] = await Promise.all([
    callAppApi<KnowledgeFileNode[]>(
      `/api/v1/files?limit=100&summary=true&view=${scope}`,
      filesService.GET as BffDomainService,
      [],
    ),
    callAppApi<NoteDoc[]>(
      `/api/v1/notes?limit=100&view=${scope}`,
      notesService.GET as BffDomainService,
      [],
    ),
  ])
  const fileIds = new Set(files.map((file) => file._id))
  return [...files, ...notes.map(noteDocToKnowledgeFile).filter((note) => !fileIds.has(note._id))]
}

export function getInitialKnowledgeMemories(): Promise<MemoryRow[]> {
  return callAppApi<MemoryRow[]>(
    '/api/v1/memory?limit=100',
    memoryService.GET as BffDomainService,
    [],
  )
}

export async function getInitialIntegrationsData(): Promise<InitialIntegrationsRouteData> {
  const [bootstrap, connected, catalog] = await Promise.all([
    callAppApi<AppBootstrapResponse | null>(
      '/api/v1/bootstrap',
      bootstrapService.GET as BffDomainService,
      null,
    ),
    callAppApi<ConnectedIntegrationsResponse | null>(
      '/api/v1/integrations',
      integrationsService.GET as BffDomainService,
      null,
    ),
    callAppApi<IntegrationSearchResponse | null>(
      '/api/v1/integrations?action=search&limit=100',
      integrationsService.GET as BffDomainService,
      null,
    ),
  ])

  return { bootstrap, connected, catalog }
}
