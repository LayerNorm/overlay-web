import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getBaseUrl } from '@/server/web/app-url'
import { getIntegrationProvider, IntegrationService } from '@/server/integrations'
import type { WorkspaceConnectorRepository } from '@/server/integrations/WorkspaceConnectorRepository'

function getAllowedAppOrigins(): string[] {
  const values = [process.env.NEXT_PUBLIC_APP_URL, process.env.DEV_NEXT_PUBLIC_APP_URL, getBaseUrl()]
  const origins = new Set<string>()
  for (const value of values) {
    if (!value?.trim()) continue
    try {
      origins.add(new URL(value).origin)
    } catch (_error) {
      // Invalid values are rejected by runtime config validation.
    }
  }
  if (process.env.NODE_ENV === 'development') {
    origins.add('http://localhost:3000')
    origins.add('http://127.0.0.1:3000')
  }
  return [...origins]
}

function resolveCallbackOrigin(request: NextRequest): string {
  const allowed = getAllowedAppOrigins()
  if (allowed.includes(request.nextUrl.origin)) return request.nextUrl.origin
  const origin = request.headers.get('origin')?.trim()
  if (origin && allowed.includes(origin)) return origin
  return new URL(getBaseUrl()).origin
}

function service() {
  const context = getOverlayServerContext()
  return new IntegrationService(getIntegrationProvider(), context.auditService)
}

interface IntegrationsRouteDependencies {
  service?: IntegrationService
  workspaceConnectors?: WorkspaceConnectorRepository
}

function catalogErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^Composio (?:is not configured|rejected the configured API key|catalog is unavailable)/.test(message)
    ? message
    : 'Failed to load integrations'
}

export async function GET(
  request: NextRequest,
  context: AppApiRouteContext,
  dependencies: IntegrationsRouteDependencies = {},
) {
  try {
    const integrations = dependencies.service ?? service()
    const { searchParams } = request.nextUrl
    const action = searchParams.get('action')

    if (action === 'health') {
      const health = await integrations.health()
      return NextResponse.json({
        provider: integrations.id,
        providerCapabilities: integrations.capabilities,
        health,
      })
    }

    if (action === 'search') {
      const parsedLimit = Number.parseInt(searchParams.get('limit') || '20', 10)
      const page = await integrations.listCatalog({
        userId: context.auth.userId,
        accessToken: context.auth.accessToken,
        query: searchParams.get('q') || undefined,
        cursor: searchParams.get('cursor') || undefined,
        limit: Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 20, 1), 100),
      })
      return NextResponse.json({
        provider: integrations.id,
        providerCapabilities: integrations.capabilities,
        data: page.items,
        items: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        syncCursor: page.syncCursor,
      })
    }

    const connected = await integrations.listConnected({
      userId: context.auth.userId,
      accessToken: context.auth.accessToken,
      workspaceId: context.workspace.workspace.id,
    })
    const workspaceConnectors = dependencies.workspaceConnectors
      ?? getOverlayServerContext().appData.repositories.workspaceConnectors
    const mappings = await workspaceConnectors.listByWorkspace({
      workspaceId: context.workspace.workspace.id,
      userId: context.auth.userId,
    })
    const mappedProviderKeys = new Set(mappings.map((mapping) => mapping.providerKey))
    const filteredConnections = connected.connections.filter((connection) => mappedProviderKeys.has(connection.providerKey))
    const filteredItems = connected.items.filter((item) => mappedProviderKeys.has(item.providerKey))
    return NextResponse.json({
      provider: integrations.id,
      providerCapabilities: integrations.capabilities,
      connected: [...new Set(filteredConnections.map((item) => item.providerKey))],
      data: filteredItems,
      items: filteredItems,
      hasMore: false,
    })
  } catch (error) {
    logger.error('[Integrations] GET failed:', error)
    return NextResponse.json({
      connected: [],
      items: [],
      error: catalogErrorMessage(error),
    }, { status: 502 })
  }
}

export async function POST(
  request: NextRequest,
  context: AppApiRouteContext,
  dependencies: IntegrationsRouteDependencies = {},
) {
  try {
    const body = await request.json() as { action?: string; providerKey?: string; toolkit?: string }
    const providerKey = (body.providerKey ?? body.toolkit)?.trim().toLowerCase()
    if (!providerKey) return NextResponse.json({ error: 'providerKey required' }, { status: 400 })
    const integrations = dependencies.service ?? service()
    const connectionContext = {
      userId: context.auth.userId,
      accessToken: context.auth.accessToken,
      callbackOrigin: resolveCallbackOrigin(request),
      providerKey,
      workspaceId: context.workspace.workspace.id,
    }

    if (body.action === 'disconnect') {
      await integrations.disconnect(connectionContext)
      const workspaceConnectors = dependencies.workspaceConnectors
        ?? getOverlayServerContext().appData.repositories.workspaceConnectors
      await workspaceConnectors.remove({
        workspaceId: context.workspace.workspace.id,
        userId: context.auth.userId,
        providerKey,
      })
      return NextResponse.json({
        success: true,
        provider: integrations.id,
        providerCapabilities: integrations.capabilities,
      })
    }

    const result = await integrations.connect(connectionContext)
    if (result.connectionId) {
      const workspaceConnectors = dependencies.workspaceConnectors
        ?? getOverlayServerContext().appData.repositories.workspaceConnectors
      await workspaceConnectors.insert({
        workspaceId: context.workspace.workspace.id,
        userId: context.auth.userId,
        providerKey,
        connectedAccountId: result.connectionId,
      })
    }
    return NextResponse.json(result)
  } catch (error) {
    logger.error('[Integrations] POST failed:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Integration operation failed',
    }, { status: 502 })
  }
}
