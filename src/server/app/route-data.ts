import 'server-only'

import { unstable_noStore as noStore } from 'next/cache'
import { headers } from 'next/headers'
import { NextRequest } from 'next/server'
import type {
  AppBootstrapResponse,
  ConnectedIntegrationsResponse,
  IntegrationSearchResponse,
  KnowledgeFileNode,
  MemoryRow,
  NoteDoc,
  ProjectSummary,
} from '@overlay/app-core'
import { noteDocToKnowledgeFile } from '@overlay/app-core'
import type { CachedConversation } from '@/shared/chat/chat-list-cache'
import type { PaginatedEnvelope } from '@/shared/api/pagination'
import { unwrapPaginatedData } from '@/shared/api/pagination'
import { getBaseUrl } from '@/server/web/app-url'
import { handleBffRoute, type BffDomainService } from '@/app/api/v1/_utils/bff'
import * as conversationsService from '@/server/app-api/v1/conversations/route'
import * as projectsService from '@/server/app-api/v1/projects/route'
import * as filesService from '@/server/app-api/v1/files/route'
import * as notesService from '@/server/app-api/v1/notes/route'
import * as memoryService from '@/server/app-api/v1/memory/route'
import * as bootstrapService from '@/server/app-api/v1/bootstrap/route'
import * as integrationsService from '@/server/app-api/v1/integrations/route'

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
  noStore()
  const headerList = await headers()
  const cookie = headerList.get('cookie')
  const url = new URL(path, originFromHeaders(headerList))
  const request = new NextRequest(url, {
    headers: cookie ? { cookie } : undefined,
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
  return callAppApi<PaginatedEnvelope<CachedConversation> | null>(
    `/api/v1/conversations?limit=${INITIAL_CHAT_LIST_LIMIT}`,
    conversationsService.GET as BffDomainService,
    null,
  )
}

export function getInitialProjectList(): Promise<ProjectSummary[]> {
  return callAppApi<ProjectSummary[]>(
    '/api/v1/projects?limit=100',
    projectsService.GET as BffDomainService,
    [],
  )
}

export async function getInitialKnowledgeFiles(): Promise<KnowledgeFileNode[]> {
  const [files, notes] = await Promise.all([
    callAppApi<KnowledgeFileNode[]>(
      '/api/v1/files?limit=100&summary=true',
      filesService.GET as BffDomainService,
      [],
    ),
    callAppApi<NoteDoc[]>(
      '/api/v1/notes?limit=100',
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
